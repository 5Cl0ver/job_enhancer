// Decide what goes in a field: the profile, then a remembered answer, or a
// reason to leave it. PURE: unit-tested in test/fill-engine.spec.js.
import { answerKey, closestAnswer, isCompanySpecific, yesNo } from "./classify/answers.js";
import { formerEmployerAnswer } from "./classify/formerEmployer.js";
import { LEGAL_KEYS, OTHER_PERSON, fieldGuard, isPhoneExtension, profileKeyFor, valueForms } from "./classify/profileKeys.js";

/**
 * A phone NUMBER where an extension goes (spec 036): an extension is at most
 * 6 digits, so 7 or more (or the profile's phone) is the whole number, never
 * the extension.
 */
export function phoneInExtension(field, value, copy = {}) {
  if (!isPhoneExtension(field)) return false;
  const digits = String(value ?? "").replace(/\D/g, "");
  const phone = String(copy.values?.phone?.[0] || "").replace(/\D/g, "");
  return digits.length >= 7 || (!!digits && digits === phone);
}

/**
 * A remembered Yes/No for a legal fact (sponsorship, work authorization;
 * never relocation, a preference) that says the opposite of the profile
 * (spec 036): the profile
 * is the fact, so the remembered one is only offered. With no profile value
 * the remembered one is used.
 */
function disagreesWithProfile(key, learned, copy) {
  if (!LEGAL_KEYS.has(key)) return false;
  const mine = (copy.values?.[key] || [])[0];
  if (!mine) return false;
  return yesNo(learned.answer) !== yesNo(mine);
}

/** The keys that make a page look like an application. */
export const IDENTITY = new Set(["first_name", "last_name", "full_name", "email", "phone"]);

const RESUME = /r[ée]sum[ée]|\bcv\b|curriculum/i;
// Whole words: "another format" or "your preferences" don't make a box something else.
const NOT_RESUME = /cover[\s_-]*letter|transcript|portfolio|writing[\s_-]*sample|\bother\b|\badditional\b|\bsupporting\b|\breferences?\b|certific/i;
const DOC_ACCEPT = /pdf|msword|officedocument|rtf|\.docx?/i;
// Another document, named in a heading or the text around a box (a page's own
// words like "other" or "additional" don't count there).
const NOT_DOC = /cover[\s_-]*letter|transcript|portfolio|writing[\s_-]*sample|certific/i;

/**
 * What an upload box is for: its own label first, then the heading above it
 * ("Cover Letter" over a Paycom card). "unclear" when it says neither but
 * takes documents.
 * @returns {"resume" | "other" | "unclear"}
 */
export function uploadKind(field) {
  const own = [field.question, field.hints?.name, field.hints?.id].join(" ");
  if (NOT_RESUME.test(own)) return "other";
  if (RESUME.test(own)) return "resume";
  const around = field.hints?.context || "";
  if (NOT_RESUME.test(around)) return "other";
  if (RESUME.test(around)) return "resume";
  // The smallest part of the page that holds it alone and names a document,
  // then its group's and section's headings (spec 029: Workday's "Upload a
  // file (5MB max)" under "Resume/CV").
  for (const text of [field.hints?.area, field.hints?.group, field.hints?.section]) {
    const t = text || "";
    const resume = RESUME.test(t);
    const other = NOT_DOC.test(t);
    if (resume && !other) return "resume";
    if (other && !resume) return "other";
  }
  // Workday's own upload box, which takes any file type.
  if (/file-upload-input/i.test(field.hints?.automation || "")) return "unclear";
  return DOC_ACCEPT.test(field.hints?.accept || "") ? "unclear" : "other";
}

/**
 * Is this file field the résumé upload (and not a cover letter etc.)? An
 * unclear box is the résumé's only when it's the page's ONLY unclear document
 * box (scan.js counts them) — never a guess between several.
 */
export function isResumeUpload(field) {
  const kind = uploadKind(field);
  return kind === "resume" || (kind === "unclear" && (field.hints?.unclearUploads ?? 1) === 1);
}

const COVER = /cover[\s_-]*letter/i;
const LETTER_BOX = new Set(["textarea", "editable"]);

/**
 * Is this upload box for the cover letter (spec 031)? Never the résumé's box.
 * Its own label says cover letter, else the text just before it, else the
 * part of the page that holds it alone, else its heading — the nearest one that says anything about a résumé or a cover
 * letter decides. A box for "résumé and cover letter" together is neither.
 */
export function isCoverLetterUpload(field) {
  if (field.kind !== "file" || isResumeUpload(field)) return false;
  const own = [field.question, field.hints?.name, field.hints?.id].join(" ");
  for (const text of [own, field.hints?.context || "", field.hints?.area || "", field.hints?.group || ""]) {
    if (RESUME.test(text)) return false;
    if (COVER.test(text)) return true;
  }
  return false;
}

// "Cover letter", "Cover Letter:", "Cover letter (paste it here)", "Your cover letter".
const COVER_LABEL = /^(your\s+|paste\s+(your\s+)?)?cover[\s_-]*letter\b/i;
const NOT_WANTED = /\b(no|not|optional|n\/a)\b/i;

/**
 * Is this a text box asking for the cover letter itself? Only when its label
 * is mainly about the letter: short, starting with "cover letter", and not
 * "no cover letter needed" or "optional". "Anything else (e.g. a cover
 * letter)?" is an essay, left for the user.
 */
export function isCoverLetterText(field) {
  if (!LETTER_BOX.has(field.kind)) return false;
  const label = String(field.question || "").trim() || [field.hints?.name, field.hints?.id].filter(Boolean).join(" ").replace(/[_-]+/g, " ");
  if (!label || label.length > 60) return false;
  return COVER_LABEL.test(label) && !NOT_WANTED.test(label) && !RESUME.test(label);
}

/** Legal identity: learned only from an explicit point-and-save, never from typing. */
export const IDENTITY_KEYS = new Set(["first_name", "last_name", "full_name", "email", "email_confirm"]);

/** Pay differs per job: a salary answer is kept for that company only. */
export const COMPANY_KEYS = new Set(["desired_salary"]);

/** Worked out fresh each time (today's date; the chosen résumé's skills): never learned, never a saved answer. */
export const COMPUTED_KEYS = new Set(["today_date", "skills"]);

/**
 * Boxes whose answer a site reformats (phone numbers, zip codes, start dates):
 * never learned from typing, only from an explicit point-and-save.
 */
export const FORMAT_KEYS = new Set(["notice_period", "phone", "phone_type", "phone_country", "postal_code"]);

// How close two wordings must be (spec 020, research R3): close enough fills,
// near is only offered ("Use saved answer"), anything less is a new question.
export const CLOSE = 0.85;
export const NEAR = 0.6;

/**
 * Where a correction to this box is remembered (spec 020): one key for the
 * question, so EVERY site asking it gets the answer.
 * - A box the profile answers: "@<profile key>" — "Preferred Name",
 *   "Preferred First Name" and "Nickname" are all "@preferred_name".
 * - A question about one company: that site only ("site|question").
 * - An essay: kept to offer ("essay|question").
 * - Anything else: the question itself, for every site.
 * Null: never remembered (self-ID, agreements, private numbers, noise).
 * @returns {{scope: "all"|"site"|"essay", key: string, profileKey?: string} | null}
 */
export function learnKeyFor(field, site) {
  const guard = fieldGuard(field);
  if (guard === "essay") return field.key ? { scope: "essay", key: answerKey("essay", site, field.key) } : null;
  // A lone checkbox that isn't an agreement is a yes/no question: remembered
  // like any other (spec 034); agreements never (the guard).
  if (guard || field.kind === "file") return null;
  // About this company ("desired salary for this role"): this site only —
  // checked before the kind of box, so it never becomes "@desired_salary".
  const profileKey = profileKeyFor(field);
  if (isCompanySpecific(field.question) || COMPANY_KEYS.has(profileKey)) return site && field.key ? { scope: "site", key: answerKey("site", site, field.key) } : null;
  if (profileKey && COMPUTED_KEYS.has(profileKey)) return null;
  if (profileKey) return { scope: "all", key: `@${profileKey}`, profileKey };
  if (!field.key || field.key.length < 3) return null;
  return { scope: "all", key: answerKey("all", site, field.key) };
}

/**
 * A remembered answer for this question, with where it came from (spec 018,
 * 020), in this order:
 *   "site"  this site's own answer ("site|question");
 *   "key"   the answer for this kind of box ("@preferred_name");
 *   "exact" the same question, asked anywhere;
 *   "close" a rewording (≥ CLOSE) — used after the profile;
 *   "offer" a near rewording (≥ NEAR) — never filled, only offered.
 * A company-specific question takes only this site's answer. Saved essays are
 * never matched here: they're offered.
 */
export function learnedFor(field, copy, profileKey = profileKeyFor(field)) {
  const answers = copy.answers || [];
  const find = (k) => answers.find((a) => a.question_key === k);
  const own = copy.site
    ? find(answerKey("site", copy.site, field.key)) ||
      (copy.host && copy.host !== copy.site ? find(answerKey("site", copy.host, field.key)) : null)
    : null;
  if (own) return { ...own, tier: "site" };
  if (isCompanySpecific(field.question) || COMPANY_KEYS.has(profileKey)) return null;
  if (profileKey) {
    const byKey = find(`@${profileKey}`);
    if (byKey) return { ...byKey, tier: "key" };
  }
  const plain = answers.filter((a) => !String(a.question_key).includes("|") && !String(a.question_key).startsWith("@"));
  const exact = field.key ? plain.find((a) => a.question_key === field.key) : null;
  if (exact) return { ...exact, tier: "exact" };
  const near = closestAnswer(field.key, plain);
  if (near && near.score >= CLOSE) return { ...near.answer, tier: "close" };
  if (near && near.score >= NEAR) return { ...near.answer, tier: "offer" };
  return null;
}

/**
 * A phone number without its country code, for a box beside a code picker:
 * "+1 (555) 010-2345" → "(555) 010-2345", "15550102345" → "5550102345".
 */
export function nationalNumber(phone) {
  const s = String(phone || "").trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) {
    // "+1 555…", "+44-20…", "+1(555)…": the code is what comes before the first break.
    const m = /^\+\d{1,3}(?=[\s.(-])[\s.-]*/.exec(s);
    if (m) return s.slice(m[0].length);
    // "+15550102345": only a North American number is safe to split unseparated.
    if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
    return s;
  }
  if (digits.length === 11 && /^1/.test(s)) return s.replace(/^1[\s.-]*/, "");
  return s;
}

// Boxes a former-employer question is answered in (never a text box).
const CHOICE_KINDS = new Set(["radio", "select", "combobox", "buttons"]);

/**
 * A lone checkbox that isn't an agreement: a yes/no question (spec 034).
 * Ticked when the answer is yes (the job history, or the user's remembered
 * answer); otherwise left unticked — unticked already says no — and listed
 * for the user only when the page requires it (`quiet` = not listed).
 */
function yesNoBox(field, copy) {
  const learned = learnedFor(field, copy, null);
  const yes = (l) => yesNo(l.answer) === "yes" || /^(true|checked|1)$/i.test(String(l.answer).trim());
  // The user's own answer on THIS site comes first (as for a radio): ticked
  // for a Yes, left unticked for a No.
  if (learned?.tier === "site") {
    return yes(learned) ? { values: ["Yes"], source: "learned", learnKey: learned.question_key } : { skip: "unknown", quiet: true };
  }
  const former = formerEmployerAnswer(field.question, copy);
  if (former === "Yes") return { values: ["Yes"], source: "history", key: "former_employer" };
  if (former === "No") return { skip: "unknown", quiet: true };
  // The same box answered on ANOTHER site (spec 034 review): never ticked by
  // itself — a tick box can attest to something about this application.
  // A Yes is offered ("Use saved answer"); a No leaves it unticked.
  if (learned?.tier === "exact") return yes(learned) ? { skip: "unknown", offer: "Yes" } : { skip: "unknown", quiet: true };
  return field.hints?.required ? { skip: "unknown" } : { skip: "unknown", quiet: true };
}

/**
 * @typedef {{values: Record<string, string[]>, answers: Array<{question_key: string, answer: string}>, resumeFile?: File|null, coverLetterFile?: File|null, coverLetterText?: string, company?: string, history?: object}} Copy
 * @returns {{values: Array<string|File>, source: "profile"|"learned", key?: string, learnKey?: string}
 *          | {skip: "sensitive"|"consent"|"essay"|"noise"|"no_data"|"unknown"|"other_file"|"other_person"|"too_long", key?: string}}
 */
export function resolve(field, copy) {
  const guard = fieldGuard(field);
  // "Paste your cover letter": the job's letter, when it has one (spec 031);
  // otherwise it stays an essay for the user (or Claude) to write.
  if (guard === "essay" && copy.coverLetterText && isCoverLetterText(field)) {
    // Never cut a letter off: a box too small for it is left for the user.
    const max = field.hints?.maxLength || 0;
    if (max > 0 && copy.coverLetterText.length > max) return { skip: "too_long", key: "cover_letter" };
    return { values: [copy.coverLetterText], source: "profile", key: "cover_letter" };
  }
  if (guard) return { skip: guard };
  if (field.kind === "file") {
    // The job's cover letter goes only in a box that clearly is for it (spec
    // 031); none = the box is left for the user (or Claude).
    if (isCoverLetterUpload(field)) {
      return copy.coverLetterFile ? { values: [copy.coverLetterFile], source: "profile", key: "cover_letter_file" } : { skip: "no_data", key: "cover_letter_file" };
    }
    if (!isResumeUpload(field)) return { skip: "other_file" };
    return copy.resumeFile ? { values: [copy.resumeFile], source: "profile", key: "resume_file" } : { skip: "no_data", key: "resume_file" };
  }
  // A lone checkbox that reads like an agreement was stopped by the guard
  // above (only the user ticks those). Any other is a yes/no question
  // ("I currently have secondary employment", spec 034).
  if (field.kind === "checkbox") return yesNoBox(field, copy);
  const key = profileKeyFor(field); // never the user's own details for someone else
  // What the user taught beats the profile (spec 020): correct a box once and
  // every site asking it gets the correction.
  const learned = COMPUTED_KEYS.has(key) ? null : learnedFor(field, copy, key);
  // The phone number remembered for an extension box (a Workday revisit
  // taken for the user's answer): never put back (spec 036).
  if (learned && phoneInExtension(field, learned.answer, copy)) return { skip: "no_data" };
  // A remembered legal Yes/No that contradicts the profile (spec 036: a
  // reversed question once saved the wrong way): offered, never filled.
  if (learned && key && disagreesWithProfile(key, learned, copy)) return { skip: "unknown", key, offer: learned.answer };
  // A learned answer, with its OWN other wordings ("Washington" → "WA") so a
  // dropdown still finds it — never the profile's old value (spec 020 review).
  const use = (l) => {
    let values = key ? valueForms(key, l.answer) : [l.answer];
    if (key === "phone" && field.hints?.dialCode) values = values.map(nationalNumber);
    return { values, source: "learned", learnKey: l.question_key, ...(key ? { key } : {}) };
  };
  if (learned && learned.tier !== "close" && learned.tier !== "offer") return use(learned);
  if (key) {
    let values = copy.values[key] || [];
    if (key === "phone" && field.hints?.dialCode) values = values.map(nationalNumber);
    if (values.length) return { values, source: "profile", key };
  }
  if (learned?.tier === "close") return use(learned);
  // "Have you previously been employed by Northwind?" (spec 034): from the
  // job history, when the company is known; the user's own answer for this
  // company (a site answer, above) wins.
  if (!key && CHOICE_KINDS.has(field.kind)) {
    const former = formerEmployerAnswer(field.question, copy);
    if (former) return { values: [former], source: "history", key: "former_employer" };
  }
  const offer = learned?.tier === "offer" ? { offer: learned.answer } : {};
  if (key) return { skip: "no_data", key, ...offer };
  // A question about someone else: a remembered answer is fine, a guess from
  // the user's own data is not.
  if (OTHER_PERSON.test(field.question || "")) return { skip: "other_person" };
  return { skip: "unknown", ...offer };
}
