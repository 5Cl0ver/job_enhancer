// "Retype your résumé" sections (spec 020, US2), before the general fill:
// Workday's rows are filled here (sections/workday.js); on other sites the
// job and school blocks are added here (sections/generic.js) and filled by
// the general engine. Data: the CHOSEN résumé's details and the profile's
// languages. No AI anywhere.
import { addRows } from "./generic.js";
import { normalizeQuestion } from "../classify/answers.js";
import { questionFor, sectionHeading } from "../scan.js";
import { shownValue } from "../widgets.js";
import { fillWorkday, inWorkdaySection, isWorkdaySections, workdayAddress } from "./workday.js";

export { inWorkdaySection, isWorkdaySections };

/** Sections already given rows on this page: a new step filled by itself never re-adds them. */
const addedHere = new WeakMap(); // document → Map(page address → Set of kinds)

const CONTROL = 'input, textarea, select, [role="combobox"], button[aria-haspopup]';

/**
 * Where a box is, in a way that survives the page redrawing it (Workday
 * rebuilds rows on Back, resumed drafts): Workday's section/row/field, else
 * the section heading, the question and which box asking it this is.
 */
export function editKey(el) {
  const wd = workdayAddress(el);
  if (wd) return wd;
  const q = normalizeQuestion(questionFor(el));
  if (!q) return null;
  const same = [...el.ownerDocument.querySelectorAll(CONTROL)].filter((c) => normalizeQuestion(questionFor(c)) === q);
  return `q|${normalizeQuestion(sectionHeading(el) || "")}|${q}|${Math.max(0, same.indexOf(el))}`;
}

export { shownValue };

/** What the sections are filled from. */
export function sectionData(copy) {
  const h = copy?.history || {};
  return {
    work: h.work || [],
    education: h.education || [],
    skills: h.skills || [],
    certifications: h.certifications || [],
    websites: h.websites || [],
    languages: copy?.languages || [],
  };
}

/**
 * @param {Document} doc
 * @param {object} copy the autofill copy (history = the chosen résumé's details)
 * @param {{session: object, auto: boolean, userEdited: Function, wait?: Function}} opts
 */
export async function fillSections(doc, copy, { session, auto, userEdited, wait }) {
  const data = sectionData(copy);
  const page = doc.location?.href?.split("#")[0] || "";
  if (!addedHere.has(doc)) addedHere.set(doc, new Map());
  const pages = addedHere.get(doc);
  if (!pages.has(page)) pages.set(page, new Set());
  const kinds = pages.get(page);
  const ctx = {
    wait: wait || ((ms) => new Promise((r) => setTimeout(r, ms))),
    auto,
    userEdited,
    // A step filled by itself only fills empty boxes and adds rows; a wrong
    // value is corrected only on a press, with the user there to see and Undo.
    put: (field, values) => session.putSection(field, values, { correct: !auto }),
    leave: (field, reason) => session.leaveField(field, reason),
    undo: (id) => session.undo(id),
    scan: () => session.scan(),
    addedBefore: (kind) => kinds.has(kind),
    added: (kind) => kinds.add(kind),
  };
  // Workday's rows are its own; anywhere else the general engine fills the
  // blocks once they're there.
  if (isWorkdaySections(doc)) return (await fillWorkday(doc, data, ctx)).filled;
  await addRows(data, ctx);
  return 0;
}
