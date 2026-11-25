// Apply with Claude (spec 022), Job Catcher's side: which presses are a final
// Submit, the photo plan, the page's answers, the Submit lock on the page,
// and the background loop doing the app's requests once each.
import { describe, it, expect, vi } from "vitest";
import { Window } from "happy-dom";
import { finalSubmitButton, finalSubmitOfForm, onRunHost, pageAnswers, shotPlan } from "../src/autofill/applyPage.js";
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
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { win, sent, m } = await mode({ active: true, guard: false });
    win.document.getElementById("send").click();
    win.document.getElementById("spa").remove(); // the SPA showed its thank-you
    await vi.advanceTimersByTimeAsync(2100);
    vi.useRealTimers();
    expect(sent.filter((x) => x.type === "applySubmitPressed")).toHaveLength(1);
    m.stop();
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

  function fakeChrome({ tabActive = true, tabs, switchAfter = Infinity } = {}) {
    const session = {};
    let gets = 0;
    const list = tabs || [
      { id: 7, windowId: 1, active: tabActive, url: `${URL1}?step=2` },
      { id: 8, windowId: 1, active: false, url: "https://other.example/" },
    ];
    return {
      storage: {
        session: {
          get: vi.fn(async (k) => (typeof k === "string" ? { [k]: session[k] } : {})),
          set: vi.fn(async (o) => Object.assign(session, o)),
        },
      },
      tabs: {
        query: vi.fn().mockResolvedValue(list),
        get: vi.fn(async (id) => {
          gets++;
          const t = list.find((x) => x.id === id);
          return gets > switchAfter ? { ...t, active: false } : t;
        }),
        sendMessage: vi.fn(async (_tab, msg) => (msg.op === "measure" ? { y: 120, height: 1800, view: 1000 } : { y: msg.y })),
        captureVisibleTab: vi.fn().mockResolvedValue("data:image/jpeg;base64,/9j/4AAQ"),
      },
      windows: { getAll: vi.fn().mockResolvedValue([{ id: 1, focused: true }]) },
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

  it("no photo when the tab isn't showing", async () => {
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: URL1, page_n: 1 }]);
    await runLoop(createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: fakeChrome({ tabActive: false }) }));
    const result = calls.find(([, p]) => p.endsWith("/result"));
    expect(JSON.parse(result[2])).toEqual({ ok: false, reason: "not_visible" });
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
    const fillSession = vi.fn().mockResolvedValue({
      frames: { 0: { entries: [{ label: "First name" }, { label: "Email" }], need_you: [{ label: "Why Acme?" }] } },
    });
    await runLoop(createApplyRun({ api, press, fillSession, chrome: fakeChrome() }));
    expect(press).toHaveBeenCalledWith(7);
    const result = calls.find(([, p]) => p.endsWith("/result"));
    expect(JSON.parse(result[2])).toEqual({ ok: true, reason: null, filled: ["First name", "Email"], need: ["Why Acme?"] });
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
    expect(await run.tick({ id: 7, url: `${URL1}?x` })).toEqual({ active: true, guard: true });
    // Before Claude's first request, any tab on the site is already locked.
    expect(await run.tick({ id: 9, url: "https://acme.example/apply/other-job" })).toEqual({ active: true, guard: true });
    expect(await run.tick({ id: 9, url: "https://news.example/" })).toEqual({ active: false, guard: false });
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
    expect(await run.tick({ id: 7, url: URL1 })).toEqual({ active: false, guard: false });
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
