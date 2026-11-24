// Matching questions to remembered answers, and answers to a field's options.
// PURE (no DOM, no chrome.*): unit-tested in test/fill-engine.spec.js.

/** Normalize a question into a stable match key (case/punctuation-insensitive). */
export function normalizeQuestion(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\(required\)|\(optional\)|required|optional/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
}

// "Pivot" tokens that FLIP a question's meaning: two questions that overlap on
// every other word but disagree on one of these are different questions (in
// the US vs in Canada, 3 vs 5 years, "authorized" vs "NOT authorized").
const NEG_WORDS = new Set(["not", "never", "cannot", "without", "non", "no"]);
// Deliberately not bare "us"/"eu": they collide with the pronoun "us".
const COUNTRY_WORDS = new Set([
  "usa", "united", "states", "america", "american",
  "canada", "canadian", "uk", "britain", "british", "england",
  "europe", "european", "india", "indian", "australia", "australian",
  "germany", "german", "france", "french", "mexico", "mexican",
  "ireland", "irish", "china", "chinese", "japan", "japanese", "singapore",
]);

const subset = (words, set) => new Set(words.filter((t) => set.has(t)));
const nums = (words) => new Set(words.filter((t) => /^\d+$/.test(t)));
const differ = (a, b) => a.size !== b.size || [...a].some((x) => !b.has(x));

/** True when two token lists disagree on a meaning-flipping token. */
// Two-letter words that say nothing about which company or thing is meant.
const SHORT_COMMON = new Set(["a", "an", "to", "of", "in", "on", "at", "by", "or", "is", "be", "do", "if", "it", "me", "my", "we", "us", "as", "so", "no", "up", "am", "go", "id"]);
const shortNames = (words) => new Set(words.filter((t) => t.length === 2 && !SHORT_COMMON.has(t) && !/^\d+$/.test(t)));

export function pivotConflict(aWords, bWords) {
  if (differ(nums(aWords), nums(bWords))) return true;
  // "an EY alumni" is not "a GE alumni": short company names count.
  if (differ(shortNames(aWords), shortNames(bWords))) return true;
  if (differ(subset(aWords, COUNTRY_WORDS), subset(bWords, COUNTRY_WORDS))) return true;
  const aNeg = aWords.some((t) => NEG_WORDS.has(t));
  const bNeg = bWords.some((t) => NEG_WORDS.has(t));
  return aNeg !== bNeg;
}

function jaccard(aWords, bWords) {
  const a = new Set(aWords.filter((t) => t.length > 2));
  const b = new Set(bWords.filter((t) => t.length > 2));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / new Set([...a, ...b]).size;
}

/**
 * A remembered answer for a question: the exact key wins; otherwise a close
 * rewording (word overlap ≥ 0.72) that doesn't disagree on a pivot token.
 * @param {string} questionKey  normalizeQuestion(question)
 * @param {Array<{question_key: string, answer: string}>} answers
 */
export function matchAnswer(questionKey, answers) {
  if (!questionKey || !answers?.length) return null;
  const exact = answers.find((a) => a.question_key === questionKey);
  if (exact) return exact;
  const qWords = questionKey.split(" ").filter(Boolean);
  if (qWords.filter((t) => t.length > 2).length < 2) return null;
  let best = null;
  let bestScore = 0;
  for (const a of answers) {
    const aWords = (a.question_key || "").split(" ").filter(Boolean);
    if (pivotConflict(qWords, aWords)) continue;
    const score = jaccard(qWords, aWords);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return bestScore >= 0.72 ? best : null;
}

/**
 * The closest remembered answer to a question by wording (spec 020), with
 * how close it is (0–1). No pivot conflicts; `answers` are plain-question ones.
 * @returns {{answer: object, score: number} | null}
 */
export function closestAnswer(questionKey, answers) {
  if (!questionKey || !answers?.length) return null;
  const qWords = questionKey.split(" ").filter(Boolean);
  if (qWords.filter((t) => t.length > 2).length < 2) return null;
  let best = null;
  let bestScore = 0;
  for (const a of answers) {
    const aWords = (a.question_key || "").split(" ").filter(Boolean);
    if (pivotConflict(qWords, aWords)) continue;
    const score = jaccard(qWords, aWords);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best ? { answer: best, score: bestScore } : null;
}

const clean = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const YES = /^(yes|y|true|i am|i do|i have|i will|i can|i agree|correct)\b/;
const NO = /^(no|n|false|i am not|i do not|i don t|i have not|i will not|i cannot|i can t)\b/;
const PLACEHOLDER = /^(select|choose|please select|select one|select an option|none selected|)$/;

/** "Yes" / "No" / null for an answer or option label. */
export function yesNo(text) {
  const t = clean(text);
  if (!t) return null;
  if (NO.test(t)) return "no";
  if (YES.test(t)) return "yes";
  return null;
}

/**
 * The option that means the same as `answer`, or null. Tried in order: exact,
 * the option's value, yes/no equivalents ("Yes, I am authorized…"), starts-with
 * either way (4+ characters), then shared words with no pivot disagreement.
 * `strict`: only an exact label or value — callers try every way of saying
 * an answer strictly before any looser match ("United States of America"
 * exactly, before "United States" as a prefix of "…Minor Outlying Islands").
 * @param {string} answer
 * @param {Array<{label: string, value?: string}>} options
 * @param {{strict?: boolean}} [opts]
 * @returns {number} the index, or -1
 */
export function matchOption(answer, options, { strict = false } = {}) {
  const want = clean(answer);
  if (!want || !options?.length) return -1;
  const labels = options.map((o) => clean(o.label));
  const usable = (i) => !PLACEHOLDER.test(labels[i]);

  let i = labels.findIndex((l, k) => usable(k) && l === want);
  if (i >= 0) return i;
  i = options.findIndex((o, k) => usable(k) && clean(o.value) === want);
  if (i >= 0) return i;
  if (strict) return -1;

  const yn = yesNo(answer);
  if (yn) {
    const hits = labels.map((l, k) => (usable(k) && yesNo(l) === yn ? k : -1)).filter((k) => k >= 0);
    if (hits.length === 1) return hits[0];
  }

  // Starts-with, only at a word boundary ("No" never picks "Not applicable"),
  // and the closest such option wins.
  const boundary = (long, short) => long.startsWith(short) && (long.length === short.length || long[short.length] === " ");
  let best = -1;
  labels.forEach((l, k) => {
    if (!usable(k) || want.length < 2) return;
    if (boundary(l, want) && (best < 0 || l.length < labels[best].length)) best = k;
  });
  if (best >= 0) return best;
  i = labels.findIndex((l, k) => usable(k) && l.length >= 4 && boundary(want, l));
  if (i >= 0) return i;

  // US states and the like: "OR" ↔ "Oregon" is handled by the caller's
  // aliases; here, shared words.
  const wWords = want.split(" ");
  best = -1;
  let bestScore = 0;
  labels.forEach((l, k) => {
    if (!usable(k)) return;
    const lWords = l.split(" ");
    if (pivotConflict(wWords, lWords)) return;
    const score = jaccard(wWords, lWords);
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  });
  return bestScore >= 0.6 ? best : -1;
}

/** Is this option label a placeholder ("Select…", "--")? */
export function isPlaceholderOption(label) {
  return PLACEHOLDER.test(clean(label));
}

/**
 * A question whose answer belongs to ONE company (spec 018): "Have you worked
 * for us before?", "Desired salary for this role", "Why this position?". Its
 * answer is saved for that company's site only, never reused elsewhere.
 */
const COMPANY_SPECIFIC =
  /\b(our|this) (company|organi[sz]ation|firm|business)\b|\b(previously |ever |currently )?(worked|been employed|applied|interviewed) (for|at|with)\b|\bwith us\b|\b(desired|expected|requested|minimum) (salary|pay|compensation|wage|rate)\b|\bsalary (for|expectations?)\b|\b(know|relatives?|family|friends?) (anyone )?(who )?(works?|employed) (here|for|at)\b|\balumn(i|us|a|ae)\b|\bformer (employee|staff|team member|intern)\b|\bpreviously (been )?employed\b|\b(worked|been) (for|at|with) [\w&.' -]{1,40} before\b/i;
// Everyday answers even when worded about this job ("How did you hear about this opportunity?").
const EVERYDAY = /\bhow did you (hear|find|learn)\b|\bwhere did you (hear|find|see)\b/i;

export function isCompanySpecific(question) {
  const q = String(question || "");
  return COMPANY_SPECIFIC.test(q) && !EVERYDAY.test(q);
}

/**
 * The key a saved answer is stored under (spec 018): the question, or
 * "site|question" for one company's answer, or "essay|question" for an essay
 * offered with "Use saved answer". Saving and looking up use this one rule,
 * so a long question finds its answer again.
 */
export function answerKey(scope, site, questionKey) {
  const base = String(questionKey || "").slice(0, 200);
  const key = scope === "essay" ? `essay|${base}` : scope === "site" ? `${site}|${base}` : base;
  return key.slice(0, 255);
}
