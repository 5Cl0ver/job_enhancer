// @vitest-environment happy-dom
// Spec 040: fixes from the 2026-11-28 Bugs & ideas reports. Workday draws its
// Skills box again after each chip (every skill after the first was "not
// added"), the phone's country code, Dayforce's standard boxes, a LinkedIn
// box that only takes a LinkedIn address. Invented applicant only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { matchOption } from "../src/autofill/classify/answers.js";
import { profileKeyFor, profileValues } from "../src/autofill/classify/profileKeys.js";
import { jobPart, jobValues } from "../src/autofill/classify/jobHistory.js";
import { resolve } from "../src/autofill/resolve.js";
import { collectFields } from "../src/autofill/scan.js";
import { createSession } from "../src/autofill/session.js";
import { CHIP_WAITS, chipsOf, homeOf, liveBox, skillWordings, writeField } from "../src/autofill/widgets.js";
import { APPLY_ALARM, createApplyRun } from "../src/background/applyRun.js";

const parse = (html) => new DOMParser().parseFromString(html, "text/html");

const PROFILE = {
  first_name: "Sam",
  last_name: "Rivera",
  phone: "555-010-2345",
  address_line1: "40 Pier Road",
  city: "Harborview",
  state: "OR",
  postal_code: "97000",
  country: "United States",
  linkedin_url: "https://www.linkedin.com/in/sam-rivera-example",
  authorized_to_work: true,
  requires_sponsorship: false,
};
const EMAIL = "sam.rivera@example.com";

/**
 * Workday's Skills prompt as it really behaves: after each chip the whole box
 * is drawn again (a new input, same id unless `newIds`), the chip list above
 * it, so the box held before is gone from the page. `delay`: the redraw comes
 * that many ms after the click.
 */
function redrawnSkills(catalog, { newIds = false, delay = 0 } = {}) {
  const w = new Window();
  const doc = w.document;
  doc.body.innerHTML = `<div data-automation-id="mainContent">
    <div data-automation-id="formField-jobTitle"><label for="t3">Job Title</label><input id="t3" value="Support Analyst"></div>
    <div data-automation-id="formField-skills"><label for="skills--skills">Type to Add Skills</label><div class="holder"></div></div></div>`;
  const holder = doc.querySelector(".holder");
  const chosen = [];
  let popup = null;
  let draws = 0;
  const close = () => {
    popup?.remove();
    popup = null;
  };
  const draw = () => {
    draws++;
    const id = newIds && draws > 1 ? `skills--skills-${draws}` : "skills--skills";
    holder.innerHTML = `<div data-automation-id="multiselectInputContainer">${
      chosen.length ? `<ul data-automation-id="selectedItemList">${chosen.map((c) => `<li data-automation-id="selectedItem">${c}</li>`).join("")}</ul>` : ""
    }<input id="${id}" data-uxi-widget-type="selectinput" placeholder="Search"></div>`;
    const input = holder.querySelector("input");
    input.addEventListener("keydown", (e) => {
      if (!input.isConnected) return; // a box drawn over is dead, as in React
      if (e.key === "Escape") return close();
      if (e.key !== "Enter") return;
      close();
      const q = input.value.toLowerCase();
      const hits = catalog.filter((c) => c.toLowerCase().includes(q));
      popup = doc.createElement("div");
      popup.setAttribute("data-automation-activepopup", "true");
      for (const h of hits) {
        const leaf = doc.createElement("div");
        leaf.setAttribute("data-automation-id", "promptLeafNode");
        leaf.setAttribute("role", "option");
        leaf.textContent = h;
        leaf.addEventListener("click", () => {
          chosen.push(h);
          close();
          if (delay) setTimeout(draw, delay);
          else draw();
        });
        popup.appendChild(leaf);
      }
      if (!hits.length) popup.innerHTML = "<p>No Items.</p>";
      doc.body.appendChild(popup);
    });
    return input;
  };
  const first = draw();
  return {
    doc,
    chosen,
    title: () => doc.querySelector("#t3").value,
    field: { id: "skills--skills", el: first, kind: "chips", question: "Type to Add Skills", hints: {} },
  };
}

const CATALOG = ["Node.js", ".NET Framework", "TypeScript", "Angular", "Microsoft Azure", "Azure Kubernetes Service (AKS)", "Angular Material"];
const chipWaits = { ...CHIP_WAITS };
afterEach(() => Object.assign(CHIP_WAITS, chipWaits));

describe("Workday Skills drawn again after each chip (dbd928ee)", () => {
  it("adds every skill, not just the first", async () => {
    const m = redrawnSkills(CATALOG);
    const res = await writeField(m.field, ["Node.js", "TypeScript", "Angular", "AKS"]);
    expect(m.chosen).toEqual(["Node.js", "TypeScript", "Angular", "Azure Kubernetes Service (AKS)"]);
    expect(res.ok).toBe(true);
    expect(res.notAdded).toBeUndefined();
    // The field now holds the box on the page, so reading it back works.
    expect(m.field.el.isConnected).toBe(true);
    expect(chipsOf(m.field.el)).toHaveLength(4);
  });

  it("Workday's own names: .NET Framework, Microsoft Azure; C# not offered is listed", async () => {
    const m = redrawnSkills(CATALOG);
    const res = await writeField(m.field, ["C#", ".NET", "Azure"]);
    expect(m.chosen).toEqual([".NET Framework", "Microsoft Azure"]);
    expect(res.notAdded).toEqual(["C#"]);
  });

  it("found again by its field when the new box has another id, after a slow redraw", async () => {
    const m = redrawnSkills(CATALOG, { newIds: true, delay: 150 });
    await writeField(m.field, ["Node.js", "TypeScript", "Angular"]);
    expect(m.chosen).toEqual(["Node.js", "TypeScript", "Angular"]);
  });

  it("never types into another box (c9de6138): the Job Title stays as it was", async () => {
    const m = redrawnSkills(CATALOG);
    m.doc.querySelector("#t3").focus();
    await writeField(m.field, ["Node.js", "Angular", "TypeScript"]);
    expect(m.title()).toBe("Support Analyst");
  });

  it("other names include Workday's", () => {
    expect(skillWordings(".NET").names).toEqual([".NET", ".NET Framework"]);
    expect(skillWordings("Azure").names).toEqual(["Azure", "Microsoft Azure"]);
    expect(skillWordings("k8s").names).toEqual(["k8s", "Kubernetes"]);
  });
});

describe("the phone's country code (f54d6947)", () => {
  const values = profileValues(PROFILE, EMAIL);

  it("'Country Phone Code' and Dayforce's 'Mobile Country Code' ask for it", () => {
    expect(profileKeyFor({ question: "Country Phone Code", hints: {} })).toBe("phone_country");
    expect(profileKeyFor({ question: "Mobile Country Code", hints: {} })).toBe("phone_country");
    expect(profileKeyFor({ question: "Country Code", hints: {} })).toBe("phone_country");
  });

  it.each([
    [["United States of America (+1)", "United States Minor Outlying Islands (+1)", "Canada (+1)"], 0],
    [["Canada (+1)", "United States (+1)", "Mexico (+52)"], 1],
    [["+44 United Kingdom", "+1 Canada", "+1 United States"], 2],
    [["Canada +1", "USA +1", "UK +44"], 1],
    [["+1", "+44", "+52"], 0],
    [["US (+1)", "CA (+1)"], 0],
  ])("picks the United States in %j", (labels, want) => {
    const options = labels.map((label) => ({ label }));
    const strict = values.phone_country.map((c) => matchOption(c, options, { strict: true })).find((i) => i >= 0);
    const i = strict ?? values.phone_country.map((c) => matchOption(c, options)).find((k) => k >= 0);
    expect(i).toBe(want);
  });

  it("Workday's single search prompt takes 'United States of America (+1)'", async () => {
    const w = new Window();
    const doc = w.document;
    doc.body.innerHTML = `<div data-automation-id="mainContent"><div data-automation-id="formField-countryPhoneCode"><label for="cpc">Country Phone Code</label>
      <div data-automation-id="multiSelectContainer"><ul data-automation-id="selectedItemList"></ul><input id="cpc" placeholder="Search"></div></div></div>`;
    const input = doc.querySelector("#cpc");
    const list = doc.querySelector("ul");
    const all = ["United States Minor Outlying Islands (+1)", "United States of America (+1)", "Canada (+1)"];
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const q = input.value.toLowerCase();
      const pop = doc.createElement("div");
      pop.setAttribute("data-automation-activepopup", "true");
      for (const h of all.filter((c) => c.toLowerCase().includes(q))) {
        const leaf = doc.createElement("div");
        leaf.setAttribute("role", "option");
        leaf.textContent = h;
        leaf.addEventListener("click", () => {
          list.innerHTML = `<li data-automation-id="selectedItem">${h}</li>`;
          pop.remove();
        });
        pop.appendChild(leaf);
      }
      doc.body.appendChild(pop);
    });
    const res = await writeField({ id: "cpc", el: input, kind: "chips", single: true, question: "Country Phone Code", hints: {} }, values.phone_country);
    expect(res.ok).toBe(true);
    expect(list.textContent).toBe("United States of America (+1)");
  });
});

describe("Dayforce's Candidate Info (e0611725)", () => {
  // Dayforce-style boxes: label, then the box (some a <select>).
  const DAYFORCE = `<form>
    <h2>Contact Information</h2>
    <label for="em">Email</label><input id="em" type="email">
    <label for="cem">Confirm Email</label><input id="cem" type="email">
    <label for="pcm">Preferred Contact Method</label><select id="pcm"><option value="">Select</option><option>Email</option><option>Phone</option><option>Text Message</option></select>
    <label for="cc">Mobile Country Code</label><select id="cc"><option value="">Select</option><option>Canada (+1)</option><option>United States (+1)</option></select>
    <label for="mp">Mobile Phone</label><input id="mp" type="tel">
    <h2>Address</h2>
    <label for="a1">Address Line 1</label><input id="a1">
    <label for="ci">City</label><input id="ci">
    <label for="zp">Zip</label><input id="zp">
    <label for="li">LinkedIn Profile</label><input id="li">
  </form>`;

  it("fills the standard boxes from the profile", async () => {
    const doc = parse(DAYFORCE);
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    await s.fillKnown({ values: profileValues(PROFILE, EMAIL), answers: [] });
    const v = (id) => doc.querySelector(`#${id}`).value;
    expect(v("em")).toBe(EMAIL);
    expect(v("cem")).toBe(EMAIL);
    expect(doc.querySelector("#pcm").selectedOptions[0].textContent).toBe("Email");
    expect(doc.querySelector("#cc").selectedOptions[0].textContent).toBe("United States (+1)");
    expect(v("a1")).toBe("40 Pier Road");
    expect(v("ci")).toBe("Harborview");
    expect(v("zp")).toBe("97000");
    expect(v("li")).toBe(PROFILE.linkedin_url);
  });

  it("a LinkedIn box takes only a LinkedIn address, never a saved answer like 'LinkedIn'", () => {
    const doc = parse(DAYFORCE);
    const field = collectFields(doc, { visible: () => true }).find((f) => f.el.id === "li");
    const copy = (linkedin, answers = []) => ({ values: profileValues({ ...PROFILE, linkedin_url: linkedin }, EMAIL), answers });
    expect(resolve(field, copy(null, [{ question_key: "@linkedin_url", answer: "LinkedIn" }]))).toMatchObject({ skip: "no_data" });
    expect(resolve(field, copy("Job board"))).toMatchObject({ skip: "no_data" });
    expect(resolve(field, copy("linkedin.com/in/sam-rivera-example"))).toMatchObject({ values: ["linkedin.com/in/sam-rivera-example"] });
  });

  it("a past job's Country comes from its location; Reason For Leaving is left", () => {
    expect(jobPart({ question: "Country", hints: {} })).toBe("country");
    expect(jobPart({ question: "Reason For Leaving", hints: {} })).toBe("");
    const job = { company: "Northwind Labs", location: "Harborview, OR" };
    expect(jobValues("country", job, { question: "Country" })).toEqual(["United States", "United States of America", "USA", "US"]);
    expect(jobValues("country", { location: "Toronto, ON, Canada" }, { question: "Country" })).toEqual(["Canada"]);
    expect(jobValues("country", { location: "Remote" }, { question: "Country" })).toEqual([]);
  });
});

describe("a fill never waits for a page to tick (bed62c61)", () => {
  function fakeChrome() {
    const alarms = new Map();
    return {
      storage: { session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }, local: { get: vi.fn(async () => ({ je_token: "t" })) } },
      tabs: { query: vi.fn(async () => []) },
      windows: { getAll: vi.fn(async () => []) },
      alarms: {
        create: vi.fn(async (name, info) => alarms.set(name, info)),
        clear: vi.fn(async (name) => alarms.delete(name)),
      },
      _alarms: alarms,
    };
  }

  it("the worker waking with a run open carries it on, and keeps a 30 s alarm while it's open", async () => {
    const c = fakeChrome();
    let open = true;
    const api = vi.fn(async (path) => ({ ok: true, json: async () => (path === "/v1/apply/active" && open ? { run_id: "r1", hosts: [], requests: [] } : { run_id: null }) }));
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      expect(await run.wake()).toBe(true);
      expect(c._alarms.get(APPLY_ALARM)).toEqual({ periodInMinutes: 0.5 });
      // The loop asks again on its own; the run ends and the alarm goes.
      open = false;
      await vi.runAllTimersAsync();
      expect(c._alarms.has(APPLY_ALARM)).toBe(false);
      expect(api.mock.calls.filter(([p]) => p === "/v1/apply/active").length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no run open: no alarm, nothing else asked", async () => {
    const c = fakeChrome();
    const api = vi.fn(async () => ({ ok: true, json: async () => ({ run_id: null }) }));
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c });
    expect(await run.wake()).toBe(false);
    expect(c.alarms.create).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledTimes(1);
  });
});

describe("review of spec 040", () => {
  const values = profileValues(PROFILE, EMAIL);
  const pick = (labels) => {
    const options = labels.map((o) => (typeof o === "string" ? { label: o } : o));
    for (const strict of [true, false]) for (const c of values.phone_country) {
      const i = matchOption(c, options, { strict });
      if (i >= 0) return i;
    }
    return -1;
  };

  it("a '+1' two options share never picks one: the United States by its name, else nothing", () => {
    expect(values.phone_country.at(-1)).toBe("+1");
    expect(pick([{ label: "Canada (+1)", value: "+1" }, { label: "United States (+1)", value: "+1" }])).toBe(1);
    expect(pick([{ label: "+1 (CA)", value: "+1" }, { label: "+1 (US)", value: "+1" }])).not.toBe(0); // never Canada
    expect(matchOption("+1", [{ label: "+1" }, { label: "+44" }])).toBe(0);
  });

  it("a non-US number with no country: no country code", () => {
    expect(profileValues({ phone: "+44 20 7946 0000" }, EMAIL).phone_country).toEqual([]);
    expect(profileValues({ phone: "+1 555 010 2345" }, EMAIL).phone_country[0]).toBe("United States of America (+1)");
    expect(profileValues({ phone: "555-010-2345" }, EMAIL).phone_country[0]).toBe("United States of America (+1)");
    expect(profileValues({ phone: "555-010-2345", country: "Canada" }, EMAIL).phone_country).toEqual([]);
  });

  it("a job's country is the United States only when it surely is", () => {
    const c = (location) => jobValues("country", { location }, { question: "Country" });
    for (const loc of ["Tbilisi, Georgia", "Toronto, CA", "Chennai, IN", "Berlin, Germany", "Remote"]) expect(c(loc)).toEqual([]);
    expect(c("Harborview, OR")[0]).toBe("United States");
    expect(c("Suite 4, Portland, OR")[0]).toBe("United States");
    expect(c("Atlanta, GA, USA")[0]).toBe("United States");
    expect(c("Toronto, ON, Canada")).toEqual(["Canada"]);
  });

  it("'Do you have a LinkedIn profile?' keeps its saved Yes; only a box you type in takes a link only", () => {
    const radio = { question: "Do you have a LinkedIn profile?", key: "do you have a linkedin profile", hints: {}, kind: "radio", options: [{ label: "Yes" }, { label: "No" }] };
    const copy = { values: {}, answers: [{ question_key: "do you have a linkedin profile", answer: "Yes" }] };
    expect(resolve(radio, copy)).toMatchObject({ values: ["Yes"] });
    expect(resolve({ ...radio, kind: "text", options: undefined }, copy)).toMatchObject({ skip: "no_data" });
  });

  it("a list of contact ticks (marketing) is never the preferred contact method", () => {
    expect(profileKeyFor({ question: "Contact preferences", kind: "checkbox_list", hints: {} })).toBeNull();
    expect(profileKeyFor({ question: "Contact preferences", kind: "checkbox", hints: {} })).toBeNull();
    expect(profileKeyFor({ question: "Preferred Contact Method", kind: "radio", hints: {} })).toBe("contact_method");
    expect(profileKeyFor({ question: "Preferred Contact Method", kind: "select", hints: {} })).toBe("contact_method");
  });

  it("the redrawn Skills box is found only in its own field, never a box elsewhere with its id", async () => {
    const w = new Window();
    const doc = w.document;
    doc.body.innerHTML = `<div data-automation-id="formField-skills"><div data-automation-id="multiselectInputContainer"><input id="sk"></div></div>
      <div data-automation-id="formField-jobTitle"><div class="spot"></div></div>`;
    const input = doc.querySelector("#sk");
    homeOf(input);
    // Redrawn: the old box gone, and only a box in ANOTHER field has its id.
    input.closest("[data-automation-id=formField-skills]").innerHTML = "";
    doc.querySelector(".spot").innerHTML = `<input id="sk">`;
    expect(liveBox(input)).toBe(input); // not the Job Title's box
    // Drawn again in its own field: found.
    doc.querySelector(".spot").innerHTML = "";
    doc.querySelector("[data-automation-id=formField-skills]").innerHTML = `<input id="sk-2">`;
    expect(liveBox(input).id).toBe("sk-2");
  });
});

describe("the wake alarm stops when there's no good answer (review)", () => {
  function chromeWith(token) {
    const alarms = new Map();
    return {
      storage: { session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }, local: { get: vi.fn(async () => token) } },
      tabs: { query: vi.fn(async () => []) },
      windows: { getAll: vi.fn(async () => []) },
      alarms: { create: vi.fn(async (n, i) => alarms.set(n, i)), clear: vi.fn(async (n) => alarms.delete(n)) },
      _alarms: alarms,
    };
  }

  it("signed out: cleared", async () => {
    const c = chromeWith({ je_token: "t" });
    let signedIn = true;
    const api = vi.fn(async () => (signedIn ? { ok: true, json: async () => ({ run_id: "r1", hosts: [], requests: [] }) } : null));
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c });
    await run.active(true);
    expect(c._alarms.has(APPLY_ALARM)).toBe(true);
    signedIn = false;
    c.storage.local.get = vi.fn(async () => ({}));
    await run.active(true);
    expect(c._alarms.has(APPLY_ALARM)).toBe(false);
  });

  it("errors for more than 90 s (401, 5xx, offline): cleared; a good answer sets it again", async () => {
    const c = chromeWith({ je_token: "t" });
    let mode = "ok";
    const api = vi.fn(async () => (mode === "ok" ? { ok: true, json: async () => ({ run_id: "r1", hosts: [], requests: [] }) } : mode === "401" ? { ok: false, status: 401 } : Promise.reject(new Error("offline"))));
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome: c });
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000_000);
      await run.active(true);
      expect(c._alarms.has(APPLY_ALARM)).toBe(true);
      mode = "401";
      now.mockReturnValue(1_030_000);
      await run.active(true);
      expect(c._alarms.has(APPLY_ALARM)).toBe(true); // a short blip keeps it
      mode = "offline";
      now.mockReturnValue(1_095_000);
      await run.active(true);
      expect(c._alarms.has(APPLY_ALARM)).toBe(false);
      mode = "ok";
      now.mockReturnValue(1_100_000);
      await run.active(true);
      expect(c._alarms.has(APPLY_ALARM)).toBe(true);
    } finally {
      now.mockRestore();
    }
  });
});
