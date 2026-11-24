// Decide what goes in a field: the profile, then a remembered answer, or a
// reason to leave it. PURE: unit-tested in test/fill-engine.spec.js.
import { matchAnswer } from "./classify/answers.js";
import { OTHER_PERSON, guardReason, profileKeyFor } from "./classify/profileKeys.js";

/** The keys that make a page look like an application. */
export const IDENTITY = new Set(["first_name", "last_name", "full_name", "email", "phone"]);

const RESUME = /r[ée]sum[ée]|\bcv\b|curriculum/i;
const NOT_RESUME = /cover[\s_-]*letter|transcript|portfolio|writing[\s_-]*sample|other|additional|supporting|reference|certific/i;
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
  if (key) {
    let values = copy.values[key] || [];
    if (key === "phone" && field.hints?.dialCode) values = values.map(nationalNumber);
    return values.length ? { values, source: "profile", key } : { skip: "no_data", key };
  }
  const learned = matchAnswer(field.key, copy.answers);
  if (learned) return { values: [learned.answer], source: "learned", learnKey: learned.question_key };
  // A question about someone else: a remembered answer is fine, an AI guess
  // (from the user's own data) is not.
  if (OTHER_PERSON.test(field.question || "")) return { skip: "other_person" };
  return { skip: "unknown" };
}
