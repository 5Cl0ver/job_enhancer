// "Retype your résumé" sections on any other site (spec 020, US2):
// Greenhouse's "+ Add another", SuccessFactors' "Add" row button, a plain
// form's "Add more". The general engine already fills one past job / school
// per block (classifySections + createJobBlocks, in session.js); this adds
// the blocks first, with the page's own Add control, until there are as many
// as the chosen résumé has entries (at most 10) — never Submit / Save / Next.
// DOM only: test/sections.spec.js; the lab covers Greenhouse and SuccessFactors.
import { classifySections, createJobBlocks, eduPart, jobPart } from "../classify/jobHistory.js";
import { textOf } from "../scan.js";
import { pointerClick } from "../widgets.js";

const ADD = /^\s*(\+\s*)?add( another| more| new)?\b/i;
const NOT_ADD = /submit|save|next|continue|apply|review|upload|attach|file|r[eé]sum[eé]|cover|sign/i;
const CONTROLS = 'button, a, [role="button"], .addRowButton, [class*="addRow"], [class*="add-another"]';
const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING

const shown = (el) => !el.getClientRects || el.getClientRects().length > 0;

/** How many past-job (or school) blocks the page shows now. */
export function countBlocks(list, kind) {
  const sections = classifySections(list);
  const blockOf = createJobBlocks();
  let n = 0;
  for (const f of list) {
    if (sections.get(f.id) !== kind) continue;
    const part = kind === "job" ? jobPart(f) : eduPart(f);
    if (part) n = Math.max(n, blockOf(part, f) + 1);
  }
  return n;
}

function commonAncestor(els) {
  let a = els[0]?.parentElement || null;
  while (a && !els.every((el) => a.contains(el))) a = a.parentElement;
  return a;
}

/** The section's own Add control: the nearest one after its last box. */
export function addControlFor(fields) {
  const els = fields.map((f) => f.el).filter(Boolean);
  if (!els.length) return null;
  const last = els[els.length - 1];
  let box = commonAncestor(els);
  for (let up = 0; box && up < 4; up++, box = box.parentElement) {
    const found = [...box.querySelectorAll(CONTROLS)].find((b) => {
      const t = textOf(b) || b.getAttribute("aria-label") || "";
      return ADD.test(t) && !NOT_ADD.test(t) && shown(b) && last.compareDocumentPosition(b) & FOLLOWING;
    });
    if (found) return found;
  }
  return null;
}

/**
 * Add job and school blocks to match the résumé's entries.
 * @param {{scan: () => object[], wait?: Function, auto?: boolean, addedBefore?: Function, added?: Function}} ctx
 * @param {{work?: object[], education?: object[]}} data
 * @returns {Promise<number>} blocks added
 */
export async function addRows(data, ctx) {
  const wait = ctx.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let added = 0;
  for (const [kind, entries] of [["job", data.work], ["education", data.education]]) {
    const want = Math.min(entries?.length || 0, 10);
    if (!want) continue;
    let list = ctx.scan();
    let have = countBlocks(list, kind);
    if (!have || have >= want) continue; // no such section here, or enough already
    if (ctx.auto && ctx.addedBefore?.(kind)) continue;
    for (let guard = 0; have < want && guard < 10; guard++) {
      const sections = classifySections(list);
      const btn = addControlFor(list.filter((f) => sections.get(f.id) === kind));
      if (!btn) break;
      pointerClick(btn);
      let grew = false;
      for (let t = 0; t < 20 && !grew; t++) {
        await wait(100);
        list = ctx.scan();
        grew = countBlocks(list, kind) > have;
      }
      if (!grew) break;
      have = countBlocks(list, kind);
      added++;
    }
    ctx.added?.(kind);
  }
  return added;
}
