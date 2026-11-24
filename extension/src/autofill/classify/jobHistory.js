// "Retype your résumé" sections (spec 018, US5). A box labelled "Address",
// "City" or "Phone" inside an Employment / Work history / Education /
// References section is about a past job, a school or another person — never
// the user's own details. Inside employment blocks, the company, title, dates
// and the job's city/state come from the résumé's work history, one block per
// job, in order.
//
// A heading alone never makes a section (a job description above the form
// says "Experience"; a question says "experience with Salesforce"): a group of
// boxes under one heading is a past-job section only when it HAS a company /
// employer box, education only with a school or degree box, references only
// with a name box plus a phone or email box. PURE: unit-tested in
// test/autofill-memory.spec.js.

const JOB = /\b(employment|employer|work (history|experience)|experience|previous (jobs?|positions?|employers?)|job history|positions? held|prior employment)\b/i;
const EDUCATION = /\b(education|schools?|universit(y|ies)|colleges?|academic)\b/i;
const REFERENCE = /\breferences?\b/i;
// A page title like "Employment Application" is the whole form, not a section.
const WHOLE_FORM = /\b(application|apply|applicant|personal|contact|about you|your information|authori[sz]ation|eligibility)\b/i;
// A box's own name that says it's about a past job (employer_city, job1_address).
const NAME_HINT = /employer|\bjob_?\d|work_?hist|prev(ious)?_?(job|employer)|workexp|emp_?\d/i;

/** The user's own details: never written into a past job's, a school's or a reference's box. */
export const PERSONAL = new Set([
  "first_name", "last_name", "full_name", "preferred_name", "middle_name", "email", "email_confirm",
  "phone", "phone_type", "phone_country", "address_line1", "address_line2", "city", "state", "postal_code",
  "country", "location", "linkedin_url", "github_url", "portfolio_url",
]);

/** What a heading alone suggests: "job", "education", "reference" or "". */
function headingKind(section) {
  if (!section || WHOLE_FORM.test(section)) return "";
  if (REFERENCE.test(section)) return "reference";
  if (JOB.test(section)) return "job";
  if (EDUCATION.test(section)) return "education";
  return "";
}

/** Which part of a past job a box asks for, or "". Dates first; an address, phone or description is never one. */
export function jobPart(field) {
  const q = `${field.question || ""} ${field.hints?.name || ""}`;
  if (/supervisor|manager|reason|duties|responsibilit|describe|description|summary|salary|wage|pay\b|contact|address|street|phone|zip|postal|email|fax/i.test(q)) return "";
  if (/\b(start(ing)?( date| month| year)?|date started|began|hire date|date of hire|from date)\b/i.test(q)) return "start";
  if (/\b(end( date| month| year)?|date ended|leaving date|to date|until|date left)\b/i.test(q)) return "end";
  if (/\b(company|employer|organi[sz]ation|business)( name)?\b/i.test(q)) return "company";
  if (/\b(job title|title|position( title| held)?|role)\b/i.test(q)) return "title";
  if (/\bcity\b/i.test(q)) return "city";
  if (/\b(state|province)\b/i.test(q)) return "state";
  return "";
}

const SCHOOLISH = /\b(school|universit|college|institution|degree|major|field of study|gpa)\b/i;
const NAMEISH = /\bname\b/i;
const REACHISH = /\b(phone|email|e-mail|telephone)\b/i;

/**
 * Which boxes sit in a past-job / education / references section (Map field
 * id → kind). Boxes are grouped by the heading above them; a group counts
 * only when its boxes prove it (see the top of this file). A box whose own
 * name says it's about a past job (employer_city) always counts.
 */
export function classifySections(fields) {
  const groups = new Map();
  for (const f of fields) {
    const s = f.hints?.section || "";
    if (!s) continue;
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(f);
  }
  const out = new Map();
  for (const [heading, members] of groups) {
    const kind = headingKind(heading);
    if (!kind) continue;
    const proven =
      kind === "job"
        ? members.some((f) => jobPart(f) === "company")
        : kind === "education"
          ? members.some((f) => SCHOOLISH.test(f.question || ""))
          : members.some((f) => NAMEISH.test(f.question || "")) && members.some((f) => REACHISH.test(f.question || ""));
    if (proven) for (const f of members) out.set(f.id, kind);
  }
  for (const f of fields) {
    if (!out.has(f.id) && NAME_HINT.test(`${f.hints?.name || ""} ${f.hints?.id || ""}`)) out.set(f.id, /reference/i.test(f.hints?.name || "") ? "reference" : "job");
  }
  return out;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");

/** What goes in one part of one past job (from the résumé), in the forms the box may take. */
export function jobValues(part, job, field) {
  if (!job) return [];
  const [city, state] = String(job.location || "").split(",").map((s) => s.trim());
  if (part === "company") return job.company ? [job.company] : [];
  if (part === "title") return job.title ? [job.title] : [];
  if (part === "city") return city ? [city] : [];
  if (part === "state") return state ? [state] : [];
  const m = part === "start" ? job.start_month : job.end_month;
  const y = part === "start" ? job.start_year : job.end_year;
  if (part === "end" && job.current) return /\b(present|current)\b/i.test(field.options?.map((o) => o.label).join(" ") || "") ? ["Present", "Current"] : [];
  if (!y) return [];
  const q = field.question || "";
  if (field.kind === "date") return [`${y}-${pad(m || 1)}-01`];
  if (field.kind === "month") return [`${y}-${pad(m || 1)}`];
  if (/\byear\b/i.test(q) && !/\bmonth\b/i.test(q)) return [String(y)];
  if (/\bmonth\b/i.test(q) && !/\byear\b/i.test(q)) return m ? [MONTHS[m - 1], pad(m), String(m)] : [];
  return m ? [`${pad(m)}/${y}`] : [String(y)];
}

/**
 * Walks a form's past-job boxes in order and says which job each belongs to:
 * a new heading ("Employer 2"), or the very same question asked again, starts
 * the next job. "Start Month" and "Start Year" are one job's start.
 */
export function createJobBlocks() {
  let index = -1;
  let heading = null;
  const seen = new Set();
  return (part, field) => {
    const h = field?.hints?.section || "";
    const key = `${part}|${field?.key || ""}`;
    if (index < 0 || (heading !== null && h !== heading) || seen.has(key)) {
      index++;
      seen.clear();
    }
    heading = h;
    seen.add(key);
    return index;
  };
}
