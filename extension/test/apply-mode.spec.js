// Apply with Claude (spec 022), Job Catcher's side: which presses are a final
// Submit, the photo plan, the page's answers, the Submit lock on the page,
// and the background loop doing the app's requests once each.
import { describe, it, expect, vi } from "vitest";
import { Window } from "happy-dom";
import { MAX_CHOICES, confirmationIn, readableText, finalSubmitButton, finalSubmitOfForm, onRunHost, pageAnswers, shotPlan, stepName } from "../src/autofill/applyPage.js";
import { clean } from "../src/extract/util.js";
import { detectContext } from "../panel/src/lib/context.ts";
import { startApplyMode } from "../src/autofill/applyMode.js";
import { createApplyRun } from "../src/background/applyRun.js";

function page(html, url = "https://acme.wd1.myworkdayjobs.com/apply") {
  const win = new Window({ url });
  win.document.write(html);
  return win;
}

describe("a final Submit", () => {
  const doc = page(`
    <button id="a">Submit</button><button id="b">Submit application</button>
    <button id="c">Submit your application</button><button id="d">Save and continue</button>
    <button id="e">Next</button><button id="f">Apply now</button><button id="g">Review</button>
    <form role="search"><button id="h">Submit</button></form>
    <div role="button" id="i"><span>Send application</span></div>
    <button id="j">Submit Application ›</button><a href="#" id="k">Submit application</a>
    <form><input type="password"><button id="l">Submit</button></form>
    <form><input autocomplete="one-time-code"><button id="m">Submit</button></form>`).document;
  it("is the send button, in the words sites use, arrows and links included", () => {
    for (const id of ["a", "b", "c", "i", "j", "k"]) expect(finalSubmitButton(doc.getElementById(id))).not.toBeNull();
  });
  it("is never a step, the button that opens an application, a search, or a sign-in's", () => {
    for (const id of ["d", "e", "f", "g", "h", "l", "m"]) expect(finalSubmitButton(doc.getElementById(id))).toBeNull();
  });
  it("counts a press on the button's own text", () => {
    expect(finalSubmitButton(doc.querySelector("#i span"))).not.toBeNull();
  });
  it("a form sent with Enter counts only when its one submit button is final", () => {
    const d = page(`<form id="f1"><input><button>Submit</button></form>
      <form id="f2"><input><button>Next</button><button>Submit</button></form>`).document;
    expect(finalSubmitOfForm({ target: d.getElementById("f1") })).not.toBeNull();
    expect(finalSubmitOfForm({ target: d.getElementById("f2") })).toBeNull();
  });
});

describe("photos and answers", () => {
  it("plans overlapping screens, at most 8, ending at the bottom", () => {
    expect(shotPlan(800, 1000)).toEqual([0]);
    expect(shotPlan(2000, 1000)).toEqual([0, 900, 1000]);
    const long = shotPlan(50_000, 1000);
    expect(long).toHaveLength(8);
    expect(long.at(-1)).toBe(49_000);
  });

  it("lists each question with its answer, never passwords or codes", () => {
    const fields = [
      { question: "First name", kind: "text" },
      { question: "Password", kind: "text", hints: { type: "password" } },
      { question: "Verification code", kind: "text" },
      { question: "Enter the code", kind: "text", hints: { autocomplete: "one-time-code" } },
      { question: "SIN", kind: "text" },
      { question: "Willing to relocate?", kind: "checkbox" },
      { question: "Résumé", kind: "file", el: { files: [{ name: "Sam - Résumé.pdf" }] } },
      { question: "Skills", kind: "multi" },
    ];
    const read = (f) => ({ "First name": "Sam", "Willing to relocate?": true, Skills: ["Intune", "Okta"] })[f.question];
    expect(pageAnswers(fields, read)).toEqual([
      { q: "First name", a: "Sam" },
      { q: "Willing to relocate?", a: "Yes" },
      { q: "Résumé", a: "Sam - Résumé.pdf" },
      { q: "Skills", a: "Intune, Okta" },
    ]);
  });

  it("marks a box the form requires, and only those (spec 037 review)", () => {
    const fields = [
      { question: "Phone Number", kind: "text", hints: { required: true } },
      { question: "Phone Extension", kind: "text", hints: {} },
      { question: "Why Tidewell?", kind: "textarea" },
    ];
    expect(pageAnswers(fields, () => "")).toEqual([
      { q: "Phone Number", a: "", required: true },
      { q: "Phone Extension", a: "" },
      { q: "Why Tidewell?", a: "" },
    ]);
  });

  it("sends each box's real choices, capped, never the prompt (spec 033)", () => {
    const vet = "Please select your veteran status";
    const fields = [
      {
        id: "v",
        question: vet,
        kind: "select",
        options: ["Select One", "I am a protected veteran", "I am not a protected veteran", "I don't wish to answer"].map((label) => ({ label })),
      },
      // Workday's dropdown shows its choices only when opened: the ones the fill saw.
      { id: "h", question: "How did you hear about us?", kind: "combobox" },
      { id: "c", question: "Country", kind: "select", options: Array.from({ length: 90 }, (_, i) => ({ label: `Country ${i} ${"x".repeat(200)}` })) },
      { id: "s", question: "City", kind: "text", el: { tagName: "INPUT" }, options: [{ label: "Portland" }, { label: "Salem" }] },
      { id: "f", question: "Résumé", kind: "file", el: { files: [] }, options: [{ label: "x" }] },
      // A radio group's own inputs never take typing.
      { id: "r", question: "Veteran?", kind: "radio", el: { tagName: "INPUT" }, options: [{ label: "Yes" }, { label: "No" }] },
    ];
    const read = (f) => ({ [vet]: "", "How did you hear about us?": "LinkedIn", Country: "", City: "Portland" })[f.question];
    const got = pageAnswers(fields, read, new Set(["h"]), { choices: new Map([["h", ["Select One", "LinkedIn", "Indeed"]]]) });
    expect(got[0]).toEqual({ q: vet, a: "", options: ["I am a protected veteran", "I am not a protected veteran", "I don't wish to answer"] });
    expect(got[1]).toEqual({ q: "How did you hear about us?", a: "LinkedIn", by: "job_catcher", options: ["LinkedIn", "Indeed"] });
    expect(got[2].options).toHaveLength(MAX_CHOICES);
    expect(Math.max(...got[2].options.map((o) => o.length))).toBe(120);
    // A box you can type in that also suggests takes typed words too.
    expect(got[3]).toEqual({ q: "City", a: "Portland", options: ["Portland", "Salem"], free: true });
    expect(got[4]).toEqual({ q: "Résumé", a: "" });
    expect(got[5]).toEqual({ q: "Veteran?", a: "", options: ["Yes", "No"] });
  });

  it("names the step on screen from the site's progress bar (spec 033)", () => {
    const workday = page(
      `<ol data-automation-id="progressBar">
        <li data-automation-id="progressBarCompletedStep"><label>My Information</label></li>
        <li data-automation-id="progressBarActiveStep"><label>current step 2 of 6</label><label>My Experience</label></li>
        <li data-automation-id="progressBarInactiveStep"><label>Application Questions</label></li>
      </ol>`,
    );
    expect(stepName(workday.document)).toBe("My Experience");
    const marked = page(`<nav><a>Contact</a><a aria-current="step">Step 3 of 4 Work history</a></nav>`);
    expect(stepName(marked.document)).toBe("Work history");
    // A bar that doesn't mark its current step names nothing (its whole text
    // would be the same on every step).
    const bar = page(`<div data-automation-id="progressBar"><span>Apply for Software Engineer</span></div>`);
    expect(stepName(bar.document)).toBe("");
    expect(stepName(page(`<h1>Apply</h1><form><input></form>`).document)).toBe("");
  });

  it("knows the run's sites, sub-hosts included", () => {
    expect(onRunHost("acme.wd1.myworkdayjobs.com", ["acme.wd1.myworkdayjobs.com"])).toBe(true);
    expect(onRunHost("www.jobs.lever.co", ["jobs.lever.co"])).toBe(true);
    expect(onRunHost("evil-lever.co", ["lever.co"])).toBe(false);
  });
});

describe("the Submit lock on the page", () => {
  async function mode(reply, { current = () => true, html } = {}) {
    const win = page(
      html ||
        `<form><input name="x"><button id="go">Submit application</button><button id="next" type="button">Next</button></form>
         <div id="spa"><div role="button" id="send">Submit application</div></div>`,
    );
    const sent = [];
    const send = vi.fn(async (m) => {
      sent.push(m);
      return m.type === "applyTick" ? reply : null;
    });
    win.document.querySelector("form")?.addEventListener("submit", (e) => e.preventDefault());
    const m = startApplyMode({ send, isCurrent: current, scan: () => [], readField: () => "", doc: win.document, win });
    await vi.waitFor(() => expect(m.state.active).toBe(reply.active));
    return { win, sent, m };
  }

  it("stops a final Submit until the user's OK, and says so once", async () => {
    const { win, sent, m } = await mode({ active: true, guard: true });
    let reachedPage = 0;
    win.document.getElementById("go").addEventListener("click", () => reachedPage++);
    win.document.getElementById("go").click();
    expect(reachedPage).toBe(0);
    expect(sent.filter((x) => x.type === "applyBlocked")).toHaveLength(1);
    win.document.getElementById("next").click(); // a step button is never stopped
    m.stop();
  });

  it("once allowed, lets it through and reports the form really sent, once", async () => {
    const { win, sent, m } = await mode({ active: true, guard: false });
    let reachedPage = 0;
    win.document.getElementById("go").addEventListener("click", () => reachedPage++);
    win.document.getElementById("go").click();
    expect(reachedPage).toBe(1);
    expect(sent.filter((x) => x.type === "applySubmitPressed")).toHaveLength(1);
    m.stop();
  });

  it("a press the site turns down (required box empty) isn't reported", async () => {
    const { win, sent, m } = await mode(
      { active: true, guard: false },
      { html: `<form><input required name="x"><button id="go">Submit application</button></form>` },
    );
    win.document.querySelector("form").dispatchEvent(new win.Event("submit", { cancelable: true }));
    expect(sent.filter((x) => x.type === "applySubmitPressed")).toHaveLength(0);
    m.stop();
  });

  it("a button with no form counts only once the page moved on", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const { win, sent, m } = await mode({ active: true, guard: false });
    win.document.getElementById("send").click();
    win.document.getElementById("spa").remove(); // the SPA showed its thank-you
    await vi.advanceTimersByTimeAsync(2100);
    expect(sent.filter((x) => x.type === "applySubmitPressed")).toHaveLength(0); // gone a moment: not yet
    await vi.advanceTimersByTimeAsync(4000);
    vi.useRealTimers();
    expect(sent.filter((x) => x.type === "applySubmitPressed")).toHaveLength(1);
    m.stop();
  });

  // Workday's Submit (spec 037): no form; disabled while it sends, then back
  // with an error banner when the site turned it down.
  const WORKDAY_SUBMIT = `<div data-automation-id="mainContent"><div id="banner"></div>
    <button type="button" id="wd-submit" data-automation-id="pageFooterNextButton">Submit</button></div>`;

  it("Workday's Submit disabled while sending, then back with an error: not 'pressed', 'didn't go through' with the error (spec 037)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const { win, sent, m } = await mode({ active: true, guard: false }, { html: WORKDAY_SUBMIT });
    const doc = win.document;
    const btn = doc.getElementById("wd-submit");
    btn.addEventListener("click", () => {
      btn.disabled = true;
      setTimeout(() => {
        // Workday re-draws the button and shows its error.
        const again = doc.createElement("button");
        again.type = "button";
        again.textContent = "Submit";
        btn.replaceWith(again);
        doc.getElementById("banner").innerHTML = '<div data-automation-id="errorMessage">Error - Page Error. Contact sam.rivera@northwind.example or call 555-010-4477.</div>';
      }, 3000);
    });
    btn.click();
    await vi.advanceTimersByTimeAsync(21_000);
    vi.useRealTimers();
    expect(sent.filter((x) => x.type === "applySubmitPressed")).toHaveLength(0);
    const failed = sent.filter((x) => x.type === "applySubmitFailed");
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toBe("Error - Page Error. Contact … or call ….");
    m.stop();
  });

  it("still sending (disabled) after 20 s, or back with no error: nothing said, still watching (spec 037 review)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const slow = await mode({ active: true, guard: false }, { html: WORKDAY_SUBMIT });
    const btn = slow.win.document.getElementById("wd-submit");
    btn.addEventListener("click", () => (btn.disabled = true));
    btn.click();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(slow.sent.filter((x) => x.type === "applySubmitFailed")).toHaveLength(0);
    // ...and a success 40 s on is still reported.
    slow.win.document.getElementById("banner").innerHTML = "<h2>Thank you for applying</h2>";
    await vi.advanceTimersByTimeAsync(1000);
    expect(slow.sent.filter((x) => x.type === "applySubmitPressed")).toHaveLength(1);
    slow.m.stop();
    const quiet = await mode({ active: true, guard: false }, { html: WORKDAY_SUBMIT });
    quiet.win.document.getElementById("wd-submit").click();
    await vi.advanceTimersByTimeAsync(30_000);
    vi.useRealTimers();
    expect(quiet.sent.filter((x) => x.type === "applySubmitFailed")).toHaveLength(0);
    quiet.m.stop();
  });

  it("while a press's outcome is pending another Submit press is stopped; once turned down, one more goes (spec 037 review)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const { win, sent, m } = await mode({ active: true, guard: false }, { html: WORKDAY_SUBMIT });
    const doc = win.document;
    let reached = 0;
    doc.getElementById("wd-submit").addEventListener("click", () => {
      reached++;
      setTimeout(() => (doc.getElementById("banner").innerHTML = '<div data-automation-id="errorMessage">Error - Page Error</div>'), 3000);
    });
    doc.getElementById("wd-submit").click();
    await vi.advanceTimersByTimeAsync(5000);
    doc.getElementById("wd-submit").click(); // too soon: stopped
    expect(reached).toBe(1);
    // Job Catcher's own hold, never the user's lock (the app words it so).
    expect(sent.filter((x) => x.type === "applyBlocked")).toEqual([expect.objectContaining({ reason: "pending" })]);
    await vi.advanceTimersByTimeAsync(16_000); // turned down at 20 s
    expect(sent.filter((x) => x.type === "applySubmitFailed")).toHaveLength(1);
    doc.getElementById("wd-submit").click(); // the one retry
    vi.useRealTimers();
    expect(reached).toBe(2);
    m.stop();
  });

  it("a late success after a turn-down is still reported (spec 037 review)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const { win, sent, m } = await mode({ active: true, guard: false }, { html: WORKDAY_SUBMIT });
    const doc = win.document;
    doc.getElementById("wd-submit").addEventListener("click", () => {
      doc.getElementById("banner").innerHTML = '<div data-automation-id="errorMessage">Error - Page Error</div>';
    });
    doc.getElementById("wd-submit").click();
    await vi.advanceTimersByTimeAsync(21_000);
    expect(sent.filter((x) => x.type === "applySubmitFailed")).toHaveLength(1);
    doc.getElementById("banner").innerHTML = "<h2>Thank you for applying</h2>";
    await vi.advanceTimersByTimeAsync(40_000);
    vi.useRealTimers();
    expect(sent.filter((x) => x.type === "applySubmitPressed")).toHaveLength(1);
    expect(sent.filter((x) => x.type === "applyConfirmed")).toHaveLength(1);
    m.stop();
  });

  it("Workday's Submit gone for 5 s with no error: sent; a confirmation: sent at once (spec 037)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const gone = await mode({ active: true, guard: false }, { html: WORKDAY_SUBMIT });
    gone.win.document.getElementById("wd-submit").click();
    gone.win.document.getElementById("wd-submit").remove();
    await vi.advanceTimersByTimeAsync(6000);
    expect(gone.sent.filter((x) => x.type === "applySubmitPressed")).toHaveLength(1);
    gone.m.stop();
    const thanks = await mode({ active: true, guard: false }, { html: WORKDAY_SUBMIT });
    thanks.win.document.getElementById("wd-submit").click();
    thanks.win.document.getElementById("banner").innerHTML = "<h2>Thank you for applying</h2>";
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    expect(thanks.sent.filter((x) => x.type === "applySubmitPressed")).toHaveLength(1);
    expect(thanks.sent.filter((x) => x.type === "applySubmitFailed")).toHaveLength(0);
    thanks.m.stop();
  });

  it("does nothing at all with no application open", async () => {
    const { win, sent, m } = await mode({ active: false, guard: false });
    win.document.getElementById("go").click();
    expect(sent.map((x) => x.type)).toEqual(["applyTick"]);
    m.stop();
  });

  it("a copy left behind by an update lets go of the lock", async () => {
    let current = true;
    const { win, sent, m } = await mode({ active: true, guard: true }, { current: () => current });
    current = false;
    let reachedPage = 0;
    win.document.getElementById("go").addEventListener("click", () => reachedPage++);
    win.document.getElementById("go").click();
    expect(reachedPage).toBe(1);
    expect(sent.filter((x) => x.type === "applyBlocked")).toHaveLength(0);
    m.stop();
  });
});

describe("the background loop", () => {
  const URL1 = "https://acme.example/apply/1";

  function fakeChrome({ tabActive = true, tabs, switchAfter = Infinity, windowState = "normal", idle = "active", capture } = {}) {
    const session = {};
    let gets = 0;
    const list = tabs || [
      { id: 7, windowId: 1, active: tabActive, url: `${URL1}?step=2` },
      { id: 8, windowId: 1, active: !tabActive, url: "https://other.example/" },
    ];
    const win = { id: 1, state: windowState, focused: true };
    return {
      storage: {
        session: {
          get: vi.fn(async (k) => (typeof k === "string" ? { [k]: session[k] } : {})),
          set: vi.fn(async (o) => Object.assign(session, o)),
        },
      },
      tabs: {
        query: vi.fn(async (q = {}) => list.filter((t) => (q.active === undefined || t.active === q.active) && (q.windowId === undefined || t.windowId === q.windowId))),
        get: vi.fn(async (id) => {
          gets++;
          const t = list.find((x) => x.id === id);
          if (!t) throw new Error("No tab");
          return gets > switchAfter ? { ...t, active: false } : { ...t };
        }),
        update: vi.fn(async (id, { active }) => {
          const t = list.find((x) => x.id === id);
          if (active) for (const o of list) if (o.windowId === t.windowId) o.active = o.id === id;
          return t;
        }),
        sendMessage: vi.fn(async (_tab, msg) => (msg.op === "measure" ? { y: 120, height: 1800, view: 1000 } : { y: msg.y })),
        captureVisibleTab: capture || vi.fn().mockResolvedValue("data:image/jpeg;base64,/9j/4AAQ"),
      },
      windows: {
        getAll: vi.fn(async () => [win]),
        get: vi.fn(async () => ({ ...win })),
        update: vi.fn(async (_id, { state }) => Object.assign(win, { state })),
      },
      idle: { queryState: vi.fn().mockResolvedValue(idle) },
      _win: win,
      _list: list,
      scripting: {
        executeScript: vi.fn().mockResolvedValue([{ result: [{ q: "Name", a: "Sam" }] }, { result: [{ q: "Email", a: "s@x" }] }]),
      },
      _session: session,
    };
  }

  function fakeApi(requests, { failFirst = false } = {}) {
    const calls = [];
    let served = 0;
    const api = vi.fn(async (path, init = {}) => {
      calls.push([init.method || "GET", path, init.body]);
      if (path === "/v1/apply/active") {
        served++;
        if (failFirst && served === 1) return { ok: false, json: async () => ({}) };
        const body = served > (failFirst ? 2 : 1) ? { run_id: null } : { run_id: "r1", guard: true, hosts: ["acme.example"], requests };
        return { ok: true, json: async () => body };
      }
      return { ok: true, json: async () => ({}) };
    });
    return { api, calls };
  }

  async function runLoop(run) {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const done = run.loop();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
  }

  it("takes the photos screen by screen, puts the scroll back, sends the answers", async () => {
    const c = fakeChrome();
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }));
    expect(calls.map(([m, p]) => `${m} ${p}`)).toEqual([
      "GET /v1/apply/active",
      "POST /v1/apply/requests/q1/claim",
      "POST /v1/apply/requests/q1/photo?part=0",
      "POST /v1/apply/requests/q1/photo?part=1",
      "POST /v1/apply/requests/q1/result",
      "GET /v1/apply/active",
    ]);
    const scrolls = c.tabs.sendMessage.mock.calls.map(([, m]) => m).filter((m) => m.op === "scroll").map((m) => m.y);
    expect(scrolls).toEqual([0, 800, 120]); // two screens, then back where it was
    expect(JSON.parse(calls[4][2])).toEqual({ ok: true, answers: [{ q: "Name", a: "Sam" }, { q: "Email", a: "s@x" }] });
    expect(c._session["je_apply_tabs:r1"]).toEqual([7]); // the run's tab, remembered
  });

  it("stops at once if the tab stops showing: another tab is never photographed", async () => {
    const c = fakeChrome({ switchAfter: 2 }); // showing for the first check only
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }));
    expect(calls.filter(([, p]) => p.includes("/photo"))).toHaveLength(0);
    const result = calls.find(([, p]) => p.endsWith("/result"));
    expect(JSON.parse(result[2]).ok).toBe(false);
  });

  it("a tab behind another is shown for its photos, then the user's tab comes back (spec 026)", async () => {
    const c = fakeChrome({ tabActive: false, idle: "idle" });
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }));
    expect(calls.filter(([, p]) => p.includes("/photo"))).toHaveLength(2);
    expect(c.tabs.update.mock.calls.map(([id]) => id)).toEqual([7, 8]);
    expect(c._list.find((t) => t.id === 8).active).toBe(true);
    expect(c.windows.update).not.toHaveBeenCalled(); // never raised over other apps
  });

  it("never takes the window from someone typing in it: the page is kept as text", async () => {
    for (const opts of [{ tabActive: false }, { windowState: "minimized" }]) {
      const c = fakeChrome({ ...opts, idle: "active" });
      const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
      await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }));
      expect(c.tabs.update).not.toHaveBeenCalled();
      expect(c.windows.update).not.toHaveBeenCalled();
      expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2])).toEqual({
        ok: false,
        reason: "busy",
        answers: [{ q: "Name", a: "Sam" }, { q: "Email", a: "s@x" }],
      });
    }
  });

  it("the user busy in another tab, then away: the photo waits, then is taken (spec 037)", async () => {
    const c = fakeChrome({ tabActive: false });
    c.idle.queryState = vi.fn().mockResolvedValueOnce("active").mockResolvedValueOnce("active").mockResolvedValue("idle");
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }));
    expect(calls.filter(([, p]) => p.includes("/photo"))).toHaveLength(2);
    expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2]).ok).toBe(true);
    expect(c._list.find((t) => t.id === 8).active).toBe(true); // the user's tab is back
  });

  it("the user clicks the application's tab while busy: photographed then, nothing switched (spec 037)", async () => {
    const c = fakeChrome({ tabActive: false });
    let looks = 0;
    c.idle.queryState = vi.fn(async () => {
      if (++looks === 3) for (const t of c._list) t.active = t.id === 7; // the user's click
      return "active";
    });
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }));
    expect(c.tabs.update).not.toHaveBeenCalled();
    expect(calls.filter(([, p]) => p.includes("/photo"))).toHaveLength(2);
  });

  it("busy the whole time: no switch, 'busy' after ~30 s of looking, the answers kept (spec 037)", async () => {
    const c = fakeChrome({ tabActive: false, idle: "active" });
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }));
    expect(c.tabs.update).not.toHaveBeenCalled();
    expect(c.idle.queryState.mock.calls.length).toBeGreaterThanOrEqual(15);
    expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2])).toEqual({ ok: false, reason: "busy", answers: [{ q: "Name", a: "Sam" }, { q: "Email", a: "s@x" }] });
  });

  it("a minimised window is restored for the photos and minimised again", async () => {
    const c = fakeChrome({ windowState: "minimized", idle: "idle" });
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }));
    expect(calls.filter(([, p]) => p.includes("/photo"))).toHaveLength(2);
    expect(c.windows.update.mock.calls.map(([, o]) => o.state)).toEqual(["normal", "minimized"]);
  });

  it("says why there's no photo, and keeps the page's answers", async () => {
    const capture = vi.fn().mockRejectedValue(new Error("hidden"));
    for (const [idle, reason] of [["locked", "locked"], ["active", "hidden"]]) {
      const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
      await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: fakeChrome({ idle, capture }) }));
      const result = JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2]);
      expect(result).toEqual({ ok: false, reason, answers: [{ q: "Name", a: "Sam" }, { q: "Email", a: "s@x" }] });
    }
  });

  it("a closed tab is said plainly", async () => {
    const c = fakeChrome();
    c.tabs.get = vi.fn().mockRejectedValue(new Error("No tab"));
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }));
    expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2])).toEqual({ ok: false, reason: "tab_closed" });
  });

  it("a computer without the application's tab leaves the request to the other", async () => {
    const c = fakeChrome({ tabs: [{ id: 8, windowId: 1, active: true, url: "https://news.example/" }] });
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }));
    expect(calls.some(([, p]) => p.endsWith("/claim"))).toBe(false);
  });

  it("fills on request, like the panel's press, and says what's left", async () => {
    const { api, calls } = fakeApi([{ id: "f1", kind: "fill", url: URL1, page_n: 1 }]);
    const press = vi.fn().mockResolvedValue({ ok: true, filled: 2, need: 1 });
    const fillSession = vi.fn().mockImplementation(async () => ({
      frames: { 0: { entries: [{ label: "First name" }, { label: "Email" }], need_you: [{ label: "Why Acme?" }], at: Date.now() } },
    }));
    await runLoop(createApplyRun({ api, press, fillSession, chrome: fakeChrome() }));
    expect(press).toHaveBeenCalledWith(7);
    const result = calls.find(([, p]) => p.endsWith("/result"));
    expect(JSON.parse(result[2])).toEqual({ ok: true, reason: null, filled: ["First name", "Email"], need: ["Why Acme?"] });
  });

  it("reports only what this fill reported, never a frame left from the last step (spec 029)", async () => {
    const { api, calls } = fakeApi([{ id: "f1", kind: "fill", url: URL1, page_n: 2 }]);
    const fillSession = vi.fn().mockImplementation(async () => ({
      frames: {
        0: { entries: [{ label: "Resume/CV" }], need_you: [], resume: "attached", at: Date.now() },
        // A frame from step 1 that didn't fill now (gone with that step).
        4: { entries: [{ label: "Phone Extension" }], need_you: [{ label: "Prefix" }], resume: "no_box", at: 1 },
      },
    }));
    await runLoop(createApplyRun({ api, press: vi.fn().mockResolvedValue({ ok: true }), fillSession, chrome: fakeChrome() }));
    expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2])).toEqual({ ok: true, reason: null, filled: ["Resume/CV"], need: [], resume: "attached" });
  });

  it("with no fresh report, says so instead of handing back an old one (spec 029 review)", async () => {
    const { api, calls } = fakeApi([{ id: "f1", kind: "fill", url: URL1, page_n: 2 }]);
    const old = { frames: { 0: { entries: [{ label: "First Name" }], need_you: [{ label: "Suffix" }], at: 1 } } };
    await runLoop(createApplyRun({ api, press: vi.fn().mockResolvedValue({ ok: true }), fillSession: vi.fn().mockResolvedValue(old), chrome: fakeChrome() }));
    expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2])).toEqual({ ok: false, reason: "no_report", filled: [], need: [] });
  });

  it("while a run is open, nothing typed in any tab is saved as the user's (spec 029 review)", async () => {
    const api = vi.fn(async () => ({ ok: true, json: async () => ({ run_id: "r1", hosts: ["myworkdayjobs.com"], requests: [] }) }));
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: fakeChrome() });
    expect(await run.inRun({ id: 7, url: "https://acme.wd1.myworkdayjobs.com/apply" })).toBe(true);
    // A site the run redirected to, before its first fill: still the run's.
    expect(await run.inRun({ id: 8, url: "https://careers.northwind.example/apply" })).toBe(true);
    const idle = createApplyRun({ api: vi.fn(async () => ({ ok: true, json: async () => ({ run_id: null }) })), press: vi.fn(), fillSession: vi.fn(), chrome: fakeChrome() });
    expect(await idle.inRun({ id: 7, url: "https://acme.wd1.myworkdayjobs.com/apply" })).toBe(false);
  });

  it("while Keep filling is filling the step, waits for ITS report instead of the last step's (spec 029)", async () => {
    const { api, calls } = fakeApi([{ id: "f1", kind: "fill", url: URL1, page_n: 2 }]);
    const old = { 0: { entries: [{ label: "First Name" }], need_you: [{ label: "Suffix" }], resume: "no_box", at: 1 } };
    let reads = 0;
    const fillSession = vi.fn().mockImplementation(async () =>
      ++reads < 3 ? { frames: old } : { frames: { 0: { entries: [{ label: "Why Tidewell?" }], need_you: [], resume: "attached", at: Date.now() } } },
    );
    await runLoop(createApplyRun({ api, press: vi.fn().mockResolvedValue({ ok: false, busy: true }), fillSession, chrome: fakeChrome() }));
    const result = JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2]);
    expect(result).toEqual({ ok: true, reason: null, filled: ["Why Tidewell?"], need: [], resume: "attached" });
  });

  it("a page that outlasts the press's wait: its late report is the answer, never 'slow' (spec 037)", async () => {
    const { api, calls } = fakeApi([{ id: "f1", kind: "fill", url: URL1, page_n: 2 }]);
    const old = { 0: { entries: [{ label: "First Name" }], need_you: [], at: 1 } };
    let reads = 0;
    // The report lands 30 reads (~30 s) after the press gave up.
    const fillSession = vi.fn().mockImplementation(async () =>
      ++reads < 30 ? { frames: old } : { frames: { 0: { entries: [{ label: "Skills" }], need_you: [{ label: "Skills not added: Cobol" }], resume: "attached", at: Date.now() } } },
    );
    await runLoop(createApplyRun({ api, press: vi.fn().mockResolvedValue({ ok: false, problem: "slow" }), fillSession, chrome: fakeChrome() }));
    const result = JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2]);
    expect(result).toEqual({ ok: true, reason: null, filled: ["Skills"], need: ["Skills not added: Cobol"], resume: "attached" });
  });

  it("a page that never reports after the press gave up: still 'slow' (spec 037)", async () => {
    const { api, calls } = fakeApi([{ id: "f1", kind: "fill", url: URL1, page_n: 2 }]);
    const old = { frames: { 0: { entries: [{ label: "First Name" }], need_you: [], at: 1 } } };
    const fillSession = vi.fn().mockResolvedValue(old);
    await runLoop(createApplyRun({ api, press: vi.fn().mockResolvedValue({ ok: false, problem: "slow" }), fillSession, chrome: fakeChrome() }));
    expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2])).toEqual({ ok: false, reason: "slow", filled: [], need: [] });
    expect(fillSession.mock.calls.length).toBeGreaterThan(100); // it waited (~170 s) first
  });

  it("a fill already going (busy) that reports after 40 s: that report, not 'no report' (spec 037)", async () => {
    const { api, calls } = fakeApi([{ id: "f1", kind: "fill", url: URL1, page_n: 2 }]);
    let reads = 0;
    const fillSession = vi.fn().mockImplementation(async () =>
      ++reads < 41 ? { frames: {} } : { frames: { 0: { entries: [{ label: "Why Tidewell?" }], need_you: [], cover_letter: "attached", at: Date.now() } } },
    );
    await runLoop(createApplyRun({ api, press: vi.fn().mockResolvedValue({ ok: false, busy: true }), fillSession, chrome: fakeChrome() }));
    expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2])).toEqual({ ok: true, reason: null, filled: ["Why Tidewell?"], need: [], cover_letter: "attached" });
  });

  it("never photographs a tab while a fill is going on it: waits for it, else says so (spec 037 review)", async () => {
    // A fill on the tab that ends after a few looks: the photo after it.
    let looks = 0;
    const c = fakeChrome();
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 2 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), filling: () => ++looks < 4, chrome: c }));
    expect(looks).toBeGreaterThanOrEqual(4);
    expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2]).ok).toBe(true);
    // Filling the whole time: no photo, never scrolled, the answers kept.
    const busy = fakeChrome();
    const two = fakeApi([{ id: "q2", kind: "photo", url: URL1, page_n: 2 }]);
    await runLoop(createApplyRun({ api: two.api, press: vi.fn(), fillSession: vi.fn(), filling: () => true, chrome: busy }));
    expect(two.calls.filter(([, p]) => p.includes("/photo"))).toHaveLength(0);
    expect(busy.tabs.sendMessage).not.toHaveBeenCalled();
    expect(JSON.parse(two.calls.find(([, p]) => p.endsWith("/result"))[2])).toEqual({ ok: false, reason: "filling", answers: [{ q: "Name", a: "Sam" }, { q: "Email", a: "s@x" }] });
    // "Show me the screen" too.
    const peek = fakeApi([{ id: "k2", kind: "peek", url: URL1, page_n: 0 }]);
    await runLoop(createApplyRun({ api: peek.api, press: vi.fn(), fillSession: vi.fn(), filling: () => true, chrome: fakeChrome() }));
    expect(JSON.parse(peek.calls.find(([, p]) => p.endsWith("/result"))[2])).toEqual({ ok: false, reason: "filling" });
  });

  it("a photo never waits behind a long fill (spec 037 review)", async () => {
    const c = fakeChrome();
    const calls = [];
    let served = 0;
    const api = vi.fn(async (path, init = {}) => {
      calls.push([init.method || "GET", path, init.body]);
      if (path === "/v1/apply/active") {
        served++;
        const requests = served === 1 ? [{ id: "f1", kind: "fill", url: URL1, page_n: 2 }] : [{ id: "q1", kind: "photo", url: URL1, page_n: 2 }];
        return { ok: true, json: async () => (served > 3 ? { run_id: null } : { run_id: "r1", guard: true, hosts: ["acme.example"], requests }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    let reads = 0;
    const fillSession = vi.fn(async () => (++reads < 60 ? { frames: {} } : { frames: { 0: { entries: [{ label: "Skills" }], need_you: [], at: Date.now() } } }));
    await runLoop(createApplyRun({ api, press: vi.fn().mockResolvedValue({ ok: false, problem: "slow" }), fillSession, chrome: c }));
    const results = calls.filter(([, p]) => p.endsWith("/result")).map(([, p]) => p);
    expect(results).toEqual(["/v1/apply/requests/q1/result", "/v1/apply/requests/f1/result"]);
  });

  it("a long fill never waits past the app's own wait: by the request's age, never the server's clock (spec 037 review)", async () => {
    const run = async (req) => {
      const { api, calls } = fakeApi([{ id: "f1", kind: "fill", url: URL1, page_n: 2, ...req }]);
      const fillSession = vi.fn().mockResolvedValue({ frames: {} });
      await runLoop(createApplyRun({ api, press: vi.fn().mockResolvedValue({ ok: false, problem: "slow" }), fillSession, chrome: fakeChrome() }));
      expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2]).reason).toBe("slow");
      return fillSession.mock.calls.length;
    };
    // Asked 100 s ago: ~70 s left.
    const left = await run({ age_s: 100 });
    expect(left).toBeGreaterThan(60);
    expect(left).toBeLessThan(80);
    // Asked 160 s ago: never less than ~30 s.
    const least = await run({ age_s: 160 });
    expect(least).toBeGreaterThan(25);
    expect(least).toBeLessThan(40);
    // A server clock an hour ahead changes nothing: only its age counts.
    const skewed = await run({ age_s: 100, created_at: new Date(Date.now() + 3_600_000).toISOString() });
    expect(Math.abs(skewed - left)).toBeLessThan(3);
  });

  it("a frame's fill report still counts after a panel action reported later (spec 037 review)", async () => {
    const { api, calls } = fakeApi([{ id: "f1", kind: "fill", url: URL1, page_n: 2 }]);
    let reads = 0;
    const fillSession = vi.fn(async () => {
      reads++;
      if (reads < 5) return { frames: {} };
      // Filled now, then the user pressed Fix in the panel: its report came last.
      return { frames: { 0: { entries: [{ label: "First Name" }], need_you: [], at: Date.now() + 5, fillAt: Date.now(), action: true } } };
    });
    await runLoop(createApplyRun({ api, press: vi.fn().mockResolvedValue({ ok: false, problem: "slow" }), fillSession, chrome: fakeChrome() }));
    expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2])).toEqual({ ok: true, reason: null, filled: ["First Name"], need: [] });
  });

  it("a late fill: every frame's report, never a panel action's (spec 037 review)", async () => {
    const { api, calls } = fakeApi([{ id: "f1", kind: "fill", url: URL1, page_n: 2 }]);
    let reads = 0;
    const fillSession = vi.fn(async () => {
      reads++;
      const frames = {};
      // A Fix from the panel meanwhile: a report, but not this fill's.
      if (reads >= 5) frames[2] = { entries: [{ label: "Fixed in the panel" }], need_you: [], at: Date.now(), action: true };
      if (reads >= 30) frames[0] = { entries: [{ label: "First Name" }], need_you: [], resume: "unverified", at: Date.now(), fillAt: Date.now() };
      if (reads >= 31) frames[3] = { entries: [{ label: "Why Tidewell?" }], need_you: [], resume: "attached", at: Date.now(), fillAt: Date.now() };
      return { frames };
    });
    await runLoop(createApplyRun({ api, press: vi.fn().mockResolvedValue({ ok: false, problem: "slow" }), fillSession, chrome: fakeChrome() }));
    expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2])).toEqual({ ok: true, reason: null, filled: ["First Name", "Why Tidewell?"], need: [], resume: "attached" });
  });

  it("never switches tabs while the user is busy in another window (spec 029)", async () => {
    const c = fakeChrome({ tabActive: false, idle: "active" });
    c._win.focused = false; // the user is working in another window
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }));
    expect(c.tabs.update).not.toHaveBeenCalled();
    expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2]).reason).toBe("busy");
  });

  it("says what happened to the résumé, the best of every frame (spec 026)", async () => {
    const { api, calls } = fakeApi([{ id: "f1", kind: "fill", url: URL1, page_n: 1 }]);
    const fillSession = vi.fn().mockImplementation(async () => ({
      frames: { 0: { entries: [], need_you: [], resume: "no_box", at: Date.now() }, 3: { entries: [], need_you: [], resume: "attached", at: Date.now() } },
    }));
    await runLoop(createApplyRun({ api, press: vi.fn().mockResolvedValue({ ok: true }), fillSession, chrome: fakeChrome() }));
    expect(JSON.parse(calls.find(([, p]) => p.endsWith("/result"))[2]).resume).toBe("attached");
  });

  it("the run's own résumé for its own tab only, never another job on the same site (spec 026)", async () => {
    const api = vi.fn(async () => ({
      ok: true,
      json: async () => ({ run_id: "r1", hosts: ["myworkdayjobs.com"], resume_id: "res-9", requests: [] }),
    }));
    const c = fakeChrome();
    c._session["je_apply_tabs:r1"] = [7];
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c });
    expect(await run.resumeFor({ id: 7, url: "https://acme.wd1.myworkdayjobs.com/apply" })).toBe("res-9");
    // Another company's Workday application in another tab.
    expect(await run.resumeFor({ id: 9, url: "https://globex.wd5.myworkdayjobs.com/apply" })).toBe(null);
    expect(await run.resumeFor({ id: 7, url: "https://www.linkedin.com/jobs/view/1" })).toBe(null);
  });

  it("sends the live view while filling, only when the page changed (spec 026)", async () => {
    const c = fakeChrome();
    c._session["je_apply_tabs:r1"] = [7];
    c.scripting.executeScript = vi.fn().mockResolvedValue([
      { result: [{ q: "First name", a: "Sam", by: "job_catcher" }, { q: "Password", a: "hunter2" }] },
    ]);
    const calls = [];
    let turns = 0;
    const api = vi.fn(async (path, init = {}) => {
      calls.push([init.method || "GET", path, init.body]);
      if (path === "/v1/apply/active") {
        turns++;
        const body = turns > 4 ? { run_id: null } : { run_id: "r1", hosts: ["acme.example"], live: true, requests: [] };
        return { ok: true, json: async () => body };
      }
      return { ok: true, status: 204, json: async () => ({}) };
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const done = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }).loop();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    const sent = calls.filter(([, p]) => p === "/v1/apply/runs/r1/live");
    expect(sent).toHaveLength(1); // the same page again isn't sent again
    expect(JSON.parse(sent[0][2])).toEqual({
      url: `${URL1}?step=2`,
      title: "",
      boxes: [{ q: "First name", a: "Sam", by: "job_catcher" }],
    });
  });

  it("sends an unchanged page again once a minute, so its step stays named (spec 033)", async () => {
    const c = fakeChrome();
    c._session["je_apply_tabs:r1"] = [7];
    c.scripting.executeScript = vi.fn().mockResolvedValue([{ result: { step: "My Information", boxes: [{ q: "Name", a: "Sam" }] } }]);
    const calls = [];
    let turns = 0;
    const api = vi.fn(async (path, init = {}) => {
      calls.push(path);
      if (path === "/v1/apply/active") {
        turns++;
        const body = turns > 40 ? { run_id: null } : { run_id: "r1", hosts: ["acme.example"], live: true, requests: [] };
        return { ok: true, json: async () => body };
      }
      return { ok: true, status: 204, json: async () => ({}) };
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const done = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }).loop();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    // About 80 s of turns: the first time, then once more after a minute.
    expect(calls.filter((p) => p === "/v1/apply/runs/r1/live")).toHaveLength(2);
  });

  it("sends the step's name and each box's choices with the live view (spec 033)", async () => {
    const c = fakeChrome();
    c._session["je_apply_tabs:r1"] = [7];
    const many = Array.from({ length: 80 }, (_, i) => `Choice ${i}`);
    c.scripting.executeScript = vi.fn().mockResolvedValue([
      { result: { step: "Voluntary Disclosures", boxes: [{ q: "Veteran status", a: "", options: many }] } },
      // A frame from an older page copy answers with just its boxes.
      { result: [{ q: "Email", a: "s@x", by: "job_catcher" }, { q: "Phone Number", a: "", required: true }] },
    ]);
    const calls = [];
    let turns = 0;
    const api = vi.fn(async (path, init = {}) => {
      calls.push([init.method || "GET", path, init.body]);
      if (path === "/v1/apply/active") {
        turns++;
        const body = turns > 2 ? { run_id: null } : { run_id: "r1", hosts: ["acme.example"], live: true, requests: [] };
        return { ok: true, json: async () => body };
      }
      return { ok: true, status: 204, json: async () => ({}) };
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const done = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }).loop();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    const [sent] = calls.filter(([, p]) => p === "/v1/apply/runs/r1/live");
    const body = JSON.parse(sent[2]);
    expect(body.step).toBe("Voluntary Disclosures");
    expect(body.boxes[0].options).toHaveLength(MAX_CHOICES);
    expect(body.boxes[1]).toEqual({ q: "Email", a: "s@x", by: "job_catcher" });
    // A box the form requires says so (spec 037 review).
    expect(body.boxes[2]).toEqual({ q: "Phone Number", a: "", required: true });
  });

  it("every tab on the site is locked, but only the application's own tab ends the run", async () => {
    const c = fakeChrome();
    c._session["je_apply_tabs:r1"] = [7];
    const calls = [];
    const api = vi.fn(async (path, init = {}) => {
      calls.push([path, init.body]);
      return { ok: true, json: async () => ({ run_id: "r1", guard: true, hosts: ["acme.example"], requests: [] }) };
    });
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c });
    run.loop = vi.fn();
    expect(await run.tick({ id: 7, url: `${URL1}?x` })).toMatchObject({ active: true, guard: true });
    // Before Claude's first request, any tab on the site is already locked.
    expect(await run.tick({ id: 9, url: "https://acme.example/apply/other-job" })).toMatchObject({ active: true, guard: true });
    expect(await run.tick({ id: 9, url: "https://news.example/" })).toMatchObject({ active: false, guard: false });
    await run.event("submit_pressed", { id: 9, url: "https://acme.example/apply/other-job" });
    await run.event("blocked_submit", { id: 9, url: "https://acme.example/apply/other-job" });
    await run.event("submit_pressed", { id: 7, url: "https://news.example/" }); // run tab, gone elsewhere
    await run.event("submit_pressed", { id: 7, url: URL1 });
    const sentEvents = calls.filter(([p]) => p.endsWith("/event")).map(([, b]) => JSON.parse(b).kind);
    expect(sentEvents).toEqual(["blocked_submit", "submit_pressed"]);
  });

  it("the run's tab, once on another site, is never photographed", async () => {
    const c = fakeChrome({ tabs: [{ id: 7, windowId: 1, active: true, url: "https://mail.example/inbox" }] });
    c._session["je_apply_tabs:r1"] = [7];
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c }));
    expect(calls.some(([, p]) => p.endsWith("/claim"))).toBe(false);
    expect(c.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("signed out means no application here; a failed refresh doesn't lift the lock", async () => {
    const c = fakeChrome();
    let signedIn = true;
    c.storage.local = { get: vi.fn(async () => (signedIn ? { je_token: "t", je_refresh: "r" } : {})) };
    let answer = { ok: true, json: async () => ({ run_id: "r1", guard: true, hosts: ["acme.example"], requests: [] }) };
    const api = vi.fn(async () => answer);
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c });
    run.loop = vi.fn();
    expect((await run.tick({ id: 7, url: URL1 })).guard).toBe(true);
    answer = null; // no token for a moment: the refresh failed
    await run.active(true);
    expect((await run.tick({ id: 7, url: URL1 })).guard).toBe(true);
    signedIn = false; // really signed out
    await run.active(true);
    expect(await run.tick({ id: 7, url: URL1 })).toMatchObject({ active: false, guard: false });
  });

  it("a server that doesn't answer never lifts the lock", async () => {
    const c = fakeChrome();
    c._session["je_apply_tabs:r1"] = [7];
    let up = true;
    const api = vi.fn(async () =>
      up
        ? { ok: true, json: async () => ({ run_id: "r1", guard: true, hosts: ["acme.example"], requests: [] }) }
        : { ok: false, json: async () => ({}) },
    );
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c });
    run.loop = vi.fn();
    expect((await run.tick({ id: 7, url: URL1 })).guard).toBe(true);
    up = false;
    await run.active(true);
    expect((await run.tick({ id: 7, url: URL1 })).guard).toBe(true);
    // …but not forever: after 90 s with no answer, it lets go.
    vi.useFakeTimers({ now: Date.now() + 120_000, toFake: ["Date"] });
    await run.active(true);
    vi.useRealTimers();
    expect((await run.tick({ id: 7, url: URL1 })).guard).toBe(false);
  });
});


describe("spec 023: the screen now, the confirmation, the small fixes", () => {
  const URL1 = "https://acme.example/apply/1";

  function chromeWith(session = {}) {
    return {
      storage: {
        session: {
          get: vi.fn(async (k) => (typeof k === "string" ? { [k]: session[k] } : {})),
          set: vi.fn(async (o) => Object.assign(session, o)),
        },
        local: { get: vi.fn(async () => ({ je_token: "t" })) },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 7, windowId: 1, active: true, url: URL1 }]),
        get: vi.fn(async () => ({ id: 7, windowId: 1, active: true, url: URL1 })),
        sendMessage: vi.fn(),
        captureVisibleTab: vi.fn().mockResolvedValue("data:image/jpeg;base64,/9j/4AAQ"),
        update: vi.fn(),
      },
      windows: {
        getAll: vi.fn().mockResolvedValue([{ id: 1, focused: true }]),
        get: vi.fn(async (id) => ({ id, state: "normal" })),
        update: vi.fn(),
      },
      scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    };
  }

  it("a screen-now photo is one shot, never scrolled", async () => {
    const c = chromeWith();
    const calls = [];
    let served = 0;
    const api = vi.fn(async (path, init = {}) => {
      calls.push(`${init.method || "GET"} ${path}`);
      if (path === "/v1/apply/active") {
        served++;
        return {
          ok: true,
          json: async () =>
            served === 1 ? { run_id: "r1", guard: true, hosts: ["acme.example"], requests: [{ id: "k1", kind: "peek", url: URL1, page_n: 0 }] } : { run_id: null },
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c });
    const done = run.loop();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(calls).toContain("POST /v1/apply/requests/k1/photo?part=0");
    expect(calls.filter((x) => x.includes("/photo"))).toHaveLength(1);
    expect(c.tabs.sendMessage).not.toHaveBeenCalled(); // no scrolling
  });

  it("the app says when to look for the confirmation, and only the application's tab looks", async () => {
    const c = chromeWith({ "je_apply_tabs:r1": [7] });
    const sent = [];
    let watch = false;
    const api = vi.fn(async (path, init = {}) => {
      if (init.body) sent.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ run_id: "r1", status: "submitting", guard: false, watch, hosts: ["acme.example"], requests: [] }) };
    });
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c });
    run.loop = vi.fn();
    expect((await run.tick({ id: 7, url: URL1 })).watch).toBe(false); // nothing pressed yet
    await run.event("submit_pressed", { id: 7, url: URL1 });
    watch = true; // the app heard the press
    expect((await run.tick({ id: 7, url: "https://acme.example/thanks" })).watch).toBe(true);
    expect((await run.tick({ id: 9, url: "https://acme.example/other-job" })).watch).toBe(false);
    // A confirmation inside an embedded form's frame is the tab's page.
    await run.event("confirmation_seen", { id: 7, url: "https://acme.example/thanks" }, "https://boards.greenhouse.io/embed/x", "Thank you for applying");
    expect(sent.at(-1)).toEqual({ kind: "confirmation_seen", url: "https://acme.example/thanks", words: "Thank you for applying" });
  });

  it("a screen-now photo is of the application's own tab, even when another shares its address", async () => {
    const c = chromeWith({ "je_apply_tabs:r1": [7] });
    c.tabs.query.mockResolvedValue([
      { id: 8, windowId: 1, active: true, url: URL1 },
      { id: 7, windowId: 2, active: true, url: URL1 + "?step=3" },
    ]);
    c.tabs.get.mockImplementation(async (id) => ({ id, windowId: id === 7 ? 2 : 1, active: true, url: id === 7 ? URL1 + "?step=3" : URL1 }));
    let served = 0;
    const api = vi.fn(async (path) => {
      if (path === "/v1/apply/active") {
        served++;
        return { ok: true, json: async () => (served === 1 ? { run_id: "r1", hosts: ["acme.example"], requests: [{ id: "k1", kind: "peek", url: URL1, page_n: 0 }] } : { run_id: null }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c });
    const done = run.loop();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(c.tabs.captureVisibleTab).toHaveBeenCalledWith(2, expect.anything());
  });

  it("the page tells the background once it shows the confirmation", async () => {
    const win = page(`<form><button id="go">Submit application</button></form><div id="msg"></div>`);
    const sent = [];
    const send = vi.fn(async (m) => {
      sent.push(m);
      if (m.type === "applyConfirmed") return { ok: true };
      return m.type === "applyTick" ? { active: true, guard: false, watch: false } : null;
    });
    win.document.querySelector("form").addEventListener("submit", (e) => e.preventDefault());
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    const m = startApplyMode({ send, isCurrent: () => true, scan: () => [], readField: () => "", doc: win.document, win });
    await vi.advanceTimersByTimeAsync(10);
    win.document.getElementById("go").click();
    win.document.getElementById("msg").textContent = "Thank you for applying! We'll be in touch.";
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(4000);
    vi.useRealTimers();
    expect(sent.filter((x) => x.type === "applyConfirmed")).toEqual([
      expect.objectContaining({ words: "Thank you for applying" }),
    ]);
    m.stop();
  });

  it("knows a confirmation from other pages", () => {
    expect(confirmationIn("Thanks for applying to Acme!")).toBe("Thanks for applying");
    expect(confirmationIn("Your application has been submitted.")).toBe("Your application has been submitted");
    expect(confirmationIn("We've received your application")).toBe("We've received your application");
    expect(confirmationIn("Review your application before you submit it")).toBe("");
    expect(confirmationIn("Apply now")).toBe("");
    expect(confirmationIn("Thank you for your interest in Acme")).toBe("");
    expect(confirmationIn("Submit application Sent: 1")).toBe("");
    expect(confirmationIn("Application submitted!")).toBe("Application submitted");
    expect(confirmationIn("We’ve received your application")).toBe("We’ve received your application");
    expect(confirmationIn("You’ve applied to Acme")).toBe("You’ve applied");
  });

  it("reads the page's words, never its buttons, labels or hidden templates", () => {
    const d = page(`<header><nav>Home</nav></header>
      <main><header><h1>Thanks for applying</h1></header><button>Submit application</button>
      <label>Application sent</label><div hidden>Your application has been submitted</div></main>`).document;
    const text = readableText(d.body);
    expect(text).toContain("Thanks for applying"); // a header inside the content counts
    expect(text).not.toContain("Home");
    expect(text).not.toContain("Submit application");
    expect(text).not.toContain("Application sent");
    expect(text).not.toContain("has been submitted");
  });

  it("words already on the page before Submit never count", async () => {
    const win = page(`<p>Thank you for applying to more jobs like this one</p><form><button id="go">Submit application</button></form>`);
    const sent = [];
    const send = vi.fn(async (m) => {
      sent.push(m);
      return m.type === "applyTick" ? { active: true, guard: false, watch: false } : null;
    });
    win.document.querySelector("form").addEventListener("submit", (e) => e.preventDefault());
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    const m = startApplyMode({ send, isCurrent: () => true, scan: () => [], readField: () => "", doc: win.document, win });
    await vi.advanceTimersByTimeAsync(10);
    win.document.getElementById("go").click();
    await vi.advanceTimersByTimeAsync(6000);
    vi.useRealTimers();
    expect(sent.filter((x) => x.type === "applyConfirmed")).toHaveLength(0);
    m.stop();
  });

  it("titles never keep HTML entities", () => {
    expect(clean("Microsoft 365 &amp; Copilot Administrator")).toBe("Microsoft 365 & Copilot Administrator");
    expect(clean("Ben &amp;amp; Jerry&#39;s")).toBe("Ben & Jerry's");
    expect(clean("AT&T")).toBe("AT&T");
  });

  it("the panel never calls Job Enhancer's own pages an application", () => {
    const app = "https://job-enhancer-xxj1.vercel.app";
    expect(detectContext(`${app}/apply/r1`, app)).toEqual({ kind: "none" });
    expect(detectContext("https://acme.example/apply/1", app).kind).toBe("application");
  });
});
