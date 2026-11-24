// Answers taught on one site before spec 020, made answers for every site.
// PURE: unit-tested in test/learn-everywhere.spec.js.
//
// Before 020 "Always use this here" saved a typed answer for one box on one
// site, so the same question on the next site started over (the user taught
// "Fabian" for Preferred Name on three sites). Each such answer becomes the
// answer for its question everywhere — once, the most recent winning — except:
//   - the legal name and email (a "First Name" box somewhere may well have
//     been a preferred-name box: only a box in a "Preferred name" block counts);
//   - questions about one company, essays, private or agreement boxes;
//   - boxes inside a past job's / school's / reference's block.
import { IDENTITY_KEYS, learnKeyFor } from "./resolve.js";

const IN_BLOCK = /\b(employ|experience|work history|education|reference)/i;

/**
 * @param {Array<{site: string, fingerprint: object, profile_key?: string|null, answer?: string|null, updated_at?: string}>} taught
 * @param {Array<{question_key: string}>} answers  already saved answers (never overwritten)
 * @returns {Array<{question_key: string, question_text: string, answer: string}>}
 */
export function promotions(taught, answers) {
  const have = new Set((answers || []).map((a) => a.question_key));
  const best = new Map(); // key → {item, at}
  const sites = new Map(); // key → sites it was taught on
  (taught || []).forEach((t, order) => {
    const answer = String(t.answer || "").trim();
    if (!answer || t.profile_key || answer.length > 300) return;
    const fp = t.fingerprint || {};
    const label = String(fp.label || "").trim();
    if (!label || IN_BLOCK.test(fp.section || "")) return;
    const field = {
      question: label,
      key: label,
      kind: fp.kind || "text",
      hints: { section: fp.section || "", autocomplete: fp.autocomplete || "" },
    };
    const learn = learnKeyFor(field, t.site);
    if (!learn || learn.scope !== "all") return;
    if (learn.profileKey && IDENTITY_KEYS.has(learn.profileKey)) return;
    if (have.has(learn.key)) return;
    sites.set(learn.key, new Set([...(sites.get(learn.key) || []), t.site]));
    const at = Date.parse(t.updated_at || "") || order;
    const held = best.get(learn.key);
    if (!held || at >= held.at) best.set(learn.key, { at, profile: !!learn.profileKey, item: { question_key: learn.key, question_text: label, answer } });
  });
  // A box the profile answers (preferred name…) is promoted at once; any other
  // question only when it was taught on two sites or more — a box taught on
  // one site may have had no real label of its own ("Quick apply").
  return [...best.entries()].filter(([key, x]) => x.profile || (sites.get(key)?.size || 0) >= 2).map(([, x]) => x.item);
}
