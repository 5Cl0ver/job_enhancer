// Apply with Claude (spec 022), Job Catcher's side: which presses are a final
// Submit, the photo plan, the page's answers, the Submit block on the page,
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
    <div role="button" id="i"><span>Send application</span></div>`).document;
  it("is the send button, in the words sites use", () => {
    for (const id of ["a", "b", "c", "i"]) expect(finalSubmitButton(doc.getElementById(id))).not.toBeNull();
  });
  it("is never a step, the button that opens an application, or a search", () => {
    for (const id of ["d", "e", "f", "g", "h"]) expect(finalSubmitButton(doc.getElementById(id))).toBeNull();
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

describe("the Submit block on the page", () => {
  async function mode(reply) {
    const win = page(`<form><input name="x"><button id="go">Submit application</button><button id="next" type="button">Next</button></form>`);
    const sent = [];
    const send = vi.fn(async (m) => {
      sent.push(m);
      return m.type === "applyTick" ? reply : null;
    });
    win.document.querySelector("form").addEventListener("submit", (e) => e.preventDefault());
    const m = startApplyMode({ send, isCurrent: () => true, scan: () => [], readField: () => "", doc: win.document, win });
    await vi.waitFor(() => expect(m.state.active).toBe(reply.active));
    return { win, sent, m };
  }

  it("stops a final Submit until the user's OK, and says so", async () => {
    const { win, sent, m } = await mode({ active: true, guard: true });
    let reachedPage = 0;
    win.document.getElementById("go").addEventListener("click", () => reachedPage++);
    win.document.getElementById("go").click();
    expect(reachedPage).toBe(0);
    expect(sent.map((x) => x.type)).toContain("applyBlocked");
    win.document.getElementById("next").click(); // a step button is never stopped
    m.stop();
  });

  it("once allowed, lets it through and reports the press", async () => {
    const { win, sent, m } = await mode({ active: true, guard: false });
    let reachedPage = 0;
    win.document.getElementById("go").addEventListener("click", () => reachedPage++);
    win.document.getElementById("go").click();
    expect(reachedPage).toBe(1);
    expect(sent.map((x) => x.type)).toContain("applySubmitPressed");
    m.stop();
  });

  it("does nothing at all with no application open", async () => {
    const { win, sent, m } = await mode({ active: false, guard: false });
    win.document.getElementById("go").click();
    expect(sent.map((x) => x.type)).toEqual(["applyTick"]);
    m.stop();
  });
});

describe("the background loop", () => {
  function fakeChrome({ tabActive = true } = {}) {
    return {
      storage: { session: { get: vi.fn().mockResolvedValue({}) } },
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 7, windowId: 1, active: tabActive, url: "https://acme.example/apply/1?step=2" },
          { id: 8, windowId: 1, active: false, url: "https://other.example/" },
        ]),
        sendMessage: vi.fn(async (_tab, msg) => (msg.op === "measure" ? { y: 120, height: 1800, view: 1000 } : { y: msg.y })),
        captureVisibleTab: vi.fn().mockResolvedValue("data:image/jpeg;base64,/9j/4AAQ"),
      },
      windows: { getAll: vi.fn().mockResolvedValue([{ id: 1, focused: true }]) },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([{ result: [{ q: "Name", a: "Sam" }] }, { result: [{ q: "Email", a: "s@x" }] }]),
      },
    };
  }

  function fakeApi(requests) {
    const calls = [];
    let served = false;
    const api = vi.fn(async (path, init = {}) => {
      calls.push([init.method || "GET", path, init.body]);
      if (path === "/v1/apply/active") {
        const body = served
          ? { run_id: null }
          : { run_id: "r1", guard: true, hosts: ["acme.example"], requests };
        served = true;
        return { ok: true, json: async () => body };
      }
      return { ok: true, json: async () => ({}) };
    });
    return { api, calls };
  }

  it("takes the photos screen by screen, puts the scroll back, sends the answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const c = fakeChrome();
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: "https://acme.example/apply/1", page_n: 1 }]);
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c });
    const done = run.loop();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
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
  });

  it("no photo when the tab isn't showing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: "https://acme.example/apply/1", page_n: 1 }]);
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: fakeChrome({ tabActive: false }) });
    const done = run.loop();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    const result = calls.find(([, p]) => p.endsWith("/result"));
    expect(JSON.parse(result[2])).toEqual({ ok: false, reason: "not_visible" });
  });

  it("fills on request, like the panel's press, and says what's left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { api, calls } = fakeApi([{ id: "f1", kind: "fill", url: "https://acme.example/apply/1", page_n: 1 }]);
    const press = vi.fn().mockResolvedValue({ ok: true, filled: 2, need: 1 });
    const fillSession = vi.fn().mockResolvedValue({
      frames: { 0: { entries: [{ label: "First name" }, { label: "Email" }], need_you: [{ label: "Why Acme?" }] } },
    });
    const run = createApplyRun({ api, press, fillSession, chrome: fakeChrome() });
    const done = run.loop();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(press).toHaveBeenCalledWith(7);
    const result = calls.find(([, p]) => p.endsWith("/result"));
    expect(JSON.parse(result[2])).toEqual({ ok: true, reason: null, filled: ["First name", "Email"], need: ["Why Acme?"] });
  });

  it("a request someone else claimed is left alone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { api, calls } = fakeApi([{ id: "q1", kind: "photo", url: "https://acme.example/apply/1", page_n: 1 }]);
    api.mockImplementation(async (path, init = {}) => {
      calls.push([init.method || "GET", path]);
      if (path.endsWith("/claim")) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => (calls.length > 2 ? { run_id: null } : { run_id: "r1", hosts: ["acme.example"], requests: [{ id: "q1", kind: "photo", url: "https://acme.example/apply/1" }] }) };
    });
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: fakeChrome() });
    const done = run.loop();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(calls.some(([, p]) => p.includes("/photo"))).toBe(false);
  });

  it("a page hears whether Submit is blocked, only on the run's sites", async () => {
    const api = vi.fn(async () => ({ ok: true, json: async () => ({ run_id: "r1", guard: true, hosts: ["acme.example"], requests: [] }) }));
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: fakeChrome() });
    run.loop = vi.fn();
    expect(await run.tick("https://acme.example/apply/1")).toEqual({ active: true, guard: true });
    expect(await run.tick("https://news.example/")).toEqual({ active: false, guard: false });
  });
});
