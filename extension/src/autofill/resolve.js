// Decide what goes in a field: the profile, then a remembered answer, or a
// reason to leave it. PURE: unit-tested in test/fill-engine.spec.js.
import { answerKey, closestAnswer, isCompanySpecific } from "./classify/answers.js";
import { OTHER_PERSON, guardReason, profileKeyFor } from "./classify/profileKeys.js";

/** The keys that make a page look like an application. */
export const IDENTITY = new Set(["first_name", "last_name", "full_name", "email", "phone"]);

const RESUME = /r[ée]sum[ée]|\bcv\b|curriculum/i;
// Whole words: "another format" or "your preferences" don't make a box something else.
const NOT_RESUME = /cover[\s_-]*letter|transcript|portfolio|writing[\s_-]*sample|\bother\b|\badditional\b|\bsupporting\b|\breferences?\b|certific/i;
const DOC_ACCEPT = /pdf|msword|officedocument|rtf|\.docx?/i;

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

/** Legal identity: learned only from an explicit point-and-save, never from typing. */
export const IDENTITY_KEYS = new Set(["first_name", "last_name", "full_name", "email", "email_confirm"]);

/** Worked out fresh each time (today's date): never learned, never a saved answer. */
export const COMPUTED_KEYS = new Set(["today_date"]);

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
  const guard = guardReason(field.question, field.kind);
  if (guard === "essay") return field.key ? { scope: "essay", key: answerKey("essay", site, field.key) } : null;
  if (guard || field.kind === "file" || field.kind === "checkbox") return null;
  // About this company ("desired salary for this role"): this site only —
  // checked before the kind of box, so it never becomes "@desired_salary".
  if (isCompanySpecific(field.question)) return site && field.key ? { scope: "site", key: answerKey("site", site, field.key) } : null;
  const profileKey = profileKeyFor(field);
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
  if (isCompanySpecific(field.question)) return null;
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

/**
 * @typedef {{values: Record<string, string[]>, answers: Array<{question_key: string, answer: string}>, resumeFile?: File|null}} Copy
 * @returns {{values: Array<string|File>, source: "profile"|"learned", key?: string, learnKey?: string}
 *          | {skip: "sensitive"|"consent"|"essay"|"noise"|"no_data"|"unknown"|"other_file"|"other_person", key?: string}}
 */
export function resolve(field, copy) {
  const guard = guardReason(field.question, field.kind);
  if (guard) return { skip: guard };
  if (field.kind === "file") {
    if (!isResumeUpload(field)) return { skip: "other_file" };
    return copy.resumeFile ? { values: [copy.resumeFile], source: "profile", key: "resume_file" } : { skip: "no_data", key: "resume_file" };
  }
  // A lone checkbox is almost always an agreement: never ticked for the user.
  if (field.kind === "checkbox") return { skip: "consent" };
  const key = profileKeyFor(field); // never the user's own details for someone else
  // What the user taught beats the profile (spec 020): correct a box once and
  // every site asking it gets the correction.
  const learned = COMPUTED_KEYS.has(key) ? null : learnedFor(field, copy, key);
  // A learned answer goes first; the profile's other wordings stay behind it
  // so a dropdown still finds "OR" when it says "Oregon" (spec 020 review).
  const use = (l) => {
    const forms = key ? (copy.values[key] || []).filter((v) => String(v).toLowerCase() !== String(l.answer).toLowerCase()) : [];
    return { values: [l.answer, ...forms], source: "learned", learnKey: l.question_key, ...(key ? { key } : {}) };
  };
  if (learned && learned.tier !== "close" && learned.tier !== "offer") return use(learned);
  if (key) {
    let values = copy.values[key] || [];
    if (key === "phone" && field.hints?.dialCode) values = values.map(nationalNumber);
    if (values.length) return { values, source: "profile", key };
  }
  if (learned?.tier === "close") return use(learned);
  const offer = learned?.tier === "offer" ? { offer: learned.answer } : {};
  if (key) return { skip: "no_data", key, ...offer };
  // A question about someone else: a remembered answer is fine, a guess from
  // the user's own data is not.
  if (OTHER_PERSON.test(field.question || "")) return { skip: "other_person" };
  return { skip: "unknown", ...offer };
}
