// "Retype your résumé" sections (spec 020, US2), before the general fill:
// Workday's rows are filled here (sections/workday.js); on other sites the
// job and school blocks are added here (sections/generic.js) and filled by
// the general engine. Data: the CHOSEN résumé's details and the profile's
// languages. No AI anywhere.
import { addRows } from "./generic.js";
import { fillWorkday, inWorkdaySection, isWorkdaySections } from "./workday.js";

export { inWorkdaySection, isWorkdaySections };

/** Sections already given rows on this page: a new step filled by itself never re-adds them. */
const addedHere = new Map(); // page address → Set of kinds

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
  if (!addedHere.has(page)) addedHere.set(page, new Set());
  const kinds = addedHere.get(page);
  const ctx = {
    wait: wait || ((ms) => new Promise((r) => setTimeout(r, ms))),
    auto,
    userEdited,
    put: (field, values) => session.putSection(field, values),
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
