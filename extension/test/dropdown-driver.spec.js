// Spec 020 (US3): dropdown lists one at a time — close what's open, open
// this one, choose, check it took, close it and make sure it closed. Never
// two open at once, never the "first option" as a guess. Workday-shaped
// widgets in happy-dom (the browser lab covers real layout).
import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { openPopupCount, searchPick, writeField } from "../src/autofill/widgets.js";

function page() {
  const w = new Window();
  const doc = w.document;
  doc.body.innerHTML = '<div data-automation-id="mainContent"><div id="form"></div></div>';
  const stats = { open: 0, max: 0, opened: 0 };
  return { w, doc, stats };
}

/**
 * A Workday-style listbox button: clicking it portals a popup to <body>;
 * Escape on the button or a click outside closes it; picking an option sets
 * the button's text. `virtual` draws only 8 rows at a time, by scroll.
 */
function listbox(ctx, id, labels, { virtual = false, sticky = false, leaf = true } = {}) {
  const { doc, stats } = ctx;
  const btn = doc.createElement("button");
  btn.id = id;
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  btn.textContent = "Select One";
  doc.getElementById("form").appendChild(btn);
  let popup = null;
  const close = () => {
    if (!popup) return;
    popup.remove();
    popup = null;
    btn.setAttribute("aria-expanded", "false");
    stats.open--;
  };
  const draw = (ul) => {
    ul.innerHTML = "";
    const first = virtual ? Math.max(0, Math.min(labels.length - 8, Math.floor(ul.scrollTop / 20))) : 0;
    for (const label of labels.slice(first, virtual ? first + 8 : labels.length)) {
      const li = doc.createElement("li");
      li.setAttribute("role", "option");
      const prompt = doc.createElement("div");
      prompt.setAttribute("data-automation-id", "promptOption");
      const target = leaf ? doc.createElement("div") : prompt;
      if (leaf) {
        target.setAttribute("data-automation-id", "promptLeafNode");
        prompt.appendChild(target);
      }
      target.textContent = label;
      target.addEventListener("click", () => {
        btn.textContent = label;
        if (!sticky) close();
      });
      li.appendChild(prompt);
      ul.appendChild(li);
    }
  };
  btn.addEventListener("click", () => {
    if (popup) return close();
    popup = doc.createElement("div");
    popup.setAttribute("data-automation-activepopup", "true");
    const ul = doc.createElement("ul");
    ul.setAttribute("role", "listbox");
    ul.addEventListener("scroll", () => draw(ul));
    draw(ul);
    popup.appendChild(ul);
    doc.body.appendChild(popup);
    btn.setAttribute("aria-expanded", "true");
    stats.open++;
    stats.opened++;
    stats.max = Math.max(stats.max, stats.open);
  });
  btn.addEventListener("keydown", (e) => e.key === "Escape" && close());
  doc.addEventListener("click", (e) => {
    if (popup && !popup.contains(e.target) && e.target !== btn) close();
  });
  return { field: { id, el: btn, kind: "combobox", question: id, hints: {} }, btn };
}

describe("one dropdown at a time", () => {
  it("closes a list left open before opening the next; never two open; none open after", async () => {
    const ctx = page();
    const a = listbox(ctx, "a", ["Yes", "No"]);
    const b = listbox(ctx, "b", ["Yes", "No"]);
    a.btn.click(); // left open by the page or the user
    expect(ctx.stats.open).toBe(1);
    const res = await writeField(b.field, ["No"]);
    expect(res.ok).toBe(true);
    expect(b.btn.textContent).toBe("No");
    expect(ctx.stats.max).toBe(1);
    expect(ctx.stats.open).toBe(0);
    expect(openPopupCount(ctx.doc)).toBe(0);
  });

  it("several in a row: each closed before the next opens", async () => {
    const ctx = page();
    const boxes = ["c", "r", "s", "w"].map((id) => listbox(ctx, id, ["1 - Beginner", "3 - Intermediate", "5 - Fluent"]));
    for (const x of boxes) expect((await writeField(x.field, ["5 - Fluent"])).ok).toBe(true);
    expect(ctx.stats.max).toBe(1);
    expect(ctx.stats.open).toBe(0);
  });

  it("a list already showing the answer isn't opened", async () => {
    const ctx = page();
    const a = listbox(ctx, "a", ["Yes", "No"]);
    a.btn.textContent = "Yes";
    expect((await writeField(a.field, ["Yes"])).ok).toBe(true);
    expect(ctx.stats.opened).toBe(0);
  });

  it("no fitting option: closed and left, never the first option", async () => {
    const ctx = page();
    const a = listbox(ctx, "a", ["Yes", "No"]);
    const res = await writeField(a.field, ["Maybe later"]);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no_option");
    expect(a.btn.textContent).toBe("Select One");
    expect(ctx.stats.open).toBe(0);
  });

  it("a list that stays open after the pick is closed and checked", async () => {
    const ctx = page();
    const a = listbox(ctx, "a", ["Yes", "No"], { sticky: true });
    expect((await writeField(a.field, ["Yes"])).ok).toBe(true);
    expect(ctx.stats.open).toBe(0);
  });

  it("scrolls a long list that only draws what's in view", async () => {
    const ctx = page();
    const langs = Array.from({ length: 60 }, (_, i) => `Language ${String(i).padStart(2, "0")}`);
    langs[47] = "Spanish";
    const a = listbox(ctx, "lang", langs, { virtual: true });
    const res = await writeField(a.field, ["Spanish"]);
    expect(res.ok).toBe(true);
    expect(a.btn.textContent).toBe("Spanish");
    expect(ctx.stats.open).toBe(0);
  });

  it("an option drawn without a leaf node is clicked itself", async () => {
    const ctx = page();
    const a = listbox(ctx, "a", ["Yes", "No"], { leaf: false });
    expect((await writeField(a.field, ["No"])).ok).toBe(true);
  });

  it("a `pick` chooses from the options (language levels)", async () => {
    const ctx = page();
    const a = listbox(ctx, "a", ["1 - Beginner", "4 - Advanced", "5 - Fluent"]);
    a.field.pick = (opts) => opts.findIndex((o) => o.label.startsWith("4"));
    expect((await writeField(a.field, ["(level 4)"])).ok).toBe(true);
    expect(a.btn.textContent).toBe("4 - Advanced");
  });
});

/** Workday's search prompt: type, Enter, results, picked items become chips. */
function multiselect(ctx, catalog, { autoPickUnique = false } = {}) {
  const { doc, stats } = ctx;
  const box = doc.createElement("div");
  box.setAttribute("data-automation-id", "multiSelectContainer");
  box.innerHTML = '<ul data-automation-id="selectedItemList"></ul><input placeholder="Search">';
  doc.getElementById("form").appendChild(box);
  const input = box.querySelector("input");
  const chips = box.querySelector("ul");
  let popup = null;
  const close = () => {
    if (!popup) return;
    popup.remove();
    popup = null;
    stats.open--;
  };
  const add = (label) => {
    const li = doc.createElement("li");
    li.setAttribute("data-automation-id", "selectedItem");
    li.textContent = label;
    chips.appendChild(li);
    input.value = "";
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return close();
    if (e.key !== "Enter") return;
    close();
    const hits = catalog.filter((c) => c.toLowerCase().includes(input.value.toLowerCase()));
    if (autoPickUnique && hits.length === 1) return add(hits[0]);
    popup = doc.createElement("div");
    popup.setAttribute("data-automation-activepopup", "true");
    for (const h of hits) {
      const leaf = doc.createElement("div");
      leaf.setAttribute("data-automation-id", "promptLeafNode");
      leaf.setAttribute("role", "option");
      leaf.textContent = h;
      leaf.addEventListener("click", () => {
        add(h);
        close();
      });
      popup.appendChild(leaf);
    }
    doc.body.appendChild(popup);
    stats.open++;
    stats.max = Math.max(stats.max, stats.open);
  });
  return { input, chips };
}

describe("search prompts (skills, schools)", () => {
  it("types each term, picks the matching result, a chip appears, nothing left open", async () => {
    const ctx = page();
    const m = multiselect(ctx, ["Python", "Python Scripting", "TypeScript", "SQL"]);
    expect((await searchPick(m.input, "Python")).ok).toBe(true);
    expect((await searchPick(m.input, "SQL")).ok).toBe(true);
    expect([...m.chips.children].map((c) => c.textContent)).toEqual(["Python", "SQL"]);
    expect(ctx.stats.open).toBe(0);
    expect(ctx.stats.max).toBe(1);
  });

  it("a term the site doesn't offer is skipped and the box cleared", async () => {
    const ctx = page();
    const m = multiselect(ctx, ["Python"]);
    const res = await searchPick(m.input, "Cobol");
    expect(res.ok).toBe(false);
    expect(m.input.value).toBe("");
    expect(ctx.stats.open).toBe(0);
  });

  it("a unique match Workday picks by itself counts; a chip already there isn't added twice", async () => {
    const ctx = page();
    const m = multiselect(ctx, ["Azure", "PowerShell"], { autoPickUnique: true });
    expect((await searchPick(m.input, "Azure")).ok).toBe(true);
    const again = await searchPick(m.input, "Azure");
    expect(again.ok).toBe(true);
    expect(again.already).toBe(true);
    expect(m.chips.children.length).toBe(1);
  });
});
