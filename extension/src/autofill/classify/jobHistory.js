// "Retype your résumé" sections (spec 018, US5). A box labelled "Address",
// "City" or "Phone" inside an Employment / Work history / Education /
// References section is about a past job, a school or another person — never
// the user's own details. The section comes from the heading above the box,
// a fieldset legend, or a name like employer_city / job1_address. Inside
// employment blocks, the company, title, dates and the job's city/state come
// from the résumé's work history, one block per job, in order.
// PURE: unit-tested in test/autofill-memory.spec.js.

const JOB = /\b(employment|employer|work (history|experience)|experience|previous (jobs?|positions?|employers?)|job history|positions? held|prior employment)\b/i;
const EDUCATION = /\b(education|schools?|universit(y|ies)|colleges?|academic)\b/i;
const REFERENCE = /\breferences?\b/i;
// A page title like "Employment Application" or "Experience your future" is
// the whole form, not a past-job section.
const WHOLE_FORM = /\b(application|apply|applicant|personal|contact|about you|your information)\b/i;
const NAME_HINT = /employ|employer|job_?\d|work_?hist|prev(ious)?_?(job|employer)|experience|workexp/i;

/** The user's own details: never written into a past job's, a school's or a reference's box. */
export const PERSONAL = new Set([
  "first_name", "last_name", "full_name", "preferred_name", "middle_name", "email", "email_confirm",
  "phone", "phone_type", "phone_country", "address_line1", "address_line2", "city", "state", "postal_code",
  "country", "location", "linkedin_url", "github_url", "portfolio_url",
]);

/** What kind of section a field sits in: "job", "education", "reference" or "". */
export function sectionKind(field) {
  const section = field.hints?.section || "";
  const names = `${field.hints?.name || ""} ${field.hints?.id || ""}`;
  if (section && !WHOLE_FORM.test(section)) {
    if (REFERENCE.test(section)) return "reference";
    if (JOB.test(section)) return "job";
    if (EDUCATION.test(section)) return "education";
  }
  if (NAME_HINT.test(names)) return /reference/i.test(names) ? "reference" : "job";
  return "";
}

/** Which part of a past job a box asks for, or "". */
export function jobPart(field) {
  const q = `${field.question || ""} ${field.hints?.name || ""}`;
  if (/supervisor|manager|reason|duties|responsibilit|describe|salary|wage|pay\b|contact/i.test(q)) return "";
  if (/\b(company|employer|organi[sz]ation|business)( name)?\b/i.test(q)) return "company";
  if (/\b(job title|title|position|role)\b/i.test(q)) return "title";
  if (/\b(start|from|began|hire[d]?|date started)\b/i.test(q)) return "start";
  if (/\b(end|to|left|until|date ended|leaving date)\b/i.test(q)) return "end";
  if (/\bcity\b/i.test(q)) return "city";
  if (/\b(state|province)\b/i.test(q)) return "state";
  return "";
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
 * Walks a form's fields in order and says which past job each employment
 * box belongs to: a part asked again (a second "Company") starts the next job.
 */
export function createJobBlocks() {
  let index = 0;
  const seen = new Set();
  return (part) => {
    if (seen.has(part)) {
      index++;
      seen.clear();
    }
    seen.add(part);
    return index;
  };
}
