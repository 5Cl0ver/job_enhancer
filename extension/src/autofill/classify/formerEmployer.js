// "Have you worked here before?" answered from the job history (spec 034).
// PURE (no DOM): unit-tested in test/workday-034.spec.js.
//
// The company is the one the question names ("…employed by Northwind
// Labs?"), else the one the application is for (the saved job linked to the
// page, the Workday job's company, the Workday site's own name). Not in the
// job history → No; in it → Yes; no company or no job history → left for
// the user, as before.

// Words a company's name ends with that don't tell two companies apart.
const SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "llc", "ltd", "limited",
  "plc", "gmbh", "lp", "llp", "ag", "sa", "bv", "pty", "group", "holdings",
]);

/** A company's name, compared loosely: lower case, no punctuation, no "Inc"/"Corp"… on the end. */
export function companyCore(name) {
  const words = String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

const flat = (s) => s.replace(/ /g, "");

/**
 * Are these the same company? Whole names, compared loosely: "Cascadia" =
 * "Cascadia Corporation", "acmecorp" (a Workday site's name) = "Acme Corp",
 * "Northwind" = "Northwind Labs". Never by a word inside another name:
 * "Apple" is not "Pineapple Labs", "Nova" is not "Novaline Systems".
 */
export function sameCompany(a, b) {
  const ca = companyCore(a);
  const cb = companyCore(b);
  if (!ca || !cb) return false;
  if (ca === cb || flat(ca) === flat(cb)) return true;
  // A Workday site's name is the company squashed together ("acmecorp").
  const fullA = flat(String(a || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""));
  const fullB = flat(String(b || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""));
  if (fullA === flat(cb) || fullB === flat(ca) || fullA === fullB) return true;
  // One whole name starting the other: "northwind" / "northwind labs".
  const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  return short.length >= 3 && long.startsWith(`${short} `);
}

// Self-employed or freelance work isn't any company's.
const SELF = /\bself[\s-]?employed\b|\bfreelanc|\bindependent (contractor|consultant)\b|^(contract|contractor|consulting|various|n\/?a|none)$/i;

/** Is this company in the user's job history? */
export function inHistory(company, history) {
  return (history?.work || []).some((w) => w?.company && !SELF.test(String(w.company).trim()) && sameCompany(w.company, company));
}

// "Previously / ever / before / former … employed / worked / contractor".
const FORMER =
  /\b(previously|formerly|ever|before|in the past|prior)\b[^?]*\b(employed|worked|work|contractor|contracted|intern(?:ed)?)\b|\b(employed|worked|contractor|intern(?:ed)?)\b[^?]*\b(previously|formerly|before|in the past|prior)\b|\bformer (employee|contractor|intern|worker|team member|staff)\b|\bcurrent or former\b/i;
// About someone else, or about applying (not working) there.
const NOT_WORK = /\brelatives?\b|\bfamily\b|\bfriends?\b|\bspouse\b|\bpartner\b|\bknow anyone\b|\breferr|\bapplied\b|\binterviewed\b|\bdifferent name\b|\bother name\b|\bgovernment\b|\bmilitary\b/i;
// "us", "this company", "here": the company the application is for.
const THIS_COMPANY = /^(us|this (company|organi[sz]ation|employer|firm|business)|our (company|organi[sz]ation|firm|business)|the company)\b/i;
// A company's name as written: capitalized words, "of"/"and"/"&" between them.
const NAME = /^([A-Z0-9][\w&.'’-]*(?:\s+(?:(?:of|and|&|the|de)\s+)?[A-Z0-9][\w&.'’-]*)*)/;
// Employment wording with the company right after it (spec 034 review):
// "employed by", "employee of", "worked for / at", "been a contractor for",
// "interned at". Never "worked with" (a tool: "worked with Python").
const EMPLOYED_BY =
  /\b(?:employed\s+by|employee\s+of|(?:worked|work|working)\s+(?:for|at)|contractor\s+(?:for|at|with)|contracted\s+(?:for|at|with|by)|intern(?:ed)?\s+(?:for|at))\s+(.+)$/i;
// Working here, said plainly.
const HERE = /\b(?:worked|work|employed|been)\s+(?:here|for us)\b|\bwith us\b|\b(?:for|at|by)\s+(?:this|our)\s+(?:company|organi[sz]ation|employer|firm)\b/i;
// More than one company, or a company's family: not a yes/no about one name.
const NOT_ONE = /,|\bor\b|\band\b|subsidiar|affiliat|\bparent\b|\bany of its\b|\bcompetitor/i;

/**
 * Is this a "have you worked for this company before?" question, and which
 * company does it ask about? `{company}`: a name it says itself; `{ours:
 * true}`: "us", "this company", "here" (the application's company). Null:
 * not that question — a tool ("worked with Python"), a list of companies,
 * "any of its subsidiaries", a kind of place ("a government agency").
 */
export function formerEmployerQuestion(question) {
  const q = String(question || "").replace(/\s+/g, " ").trim();
  if (!q || !FORMER.test(q) || NOT_WORK.test(q)) return null;
  if (HERE.test(q)) return NOT_ONE.test(q.replace(/\bcurrent or former\b/i, "")) ? null : { ours: true };
  const m = EMPLOYED_BY.exec(q);
  if (!m) return null;
  const target = m[1].replace(/\?.*$/, "").replace(/\s+(before|previously|in the past|as an? .*|at any time.*)$/i, "").trim();
  if (THIS_COMPANY.test(target)) return { ours: true };
  if (NOT_ONE.test(target)) return null;
  const name = NAME.exec(target)?.[1]?.replace(/[.,'’]+$/, "").trim();
  if (!name || /^(a|an|any|the)$/i.test(name)) return null;
  return { company: name };
}

/**
 * "Yes" / "No" for a former-employer question, from the job history; null
 * when it isn't one, the company can't be worked out, or there's no history.
 * @param {string} question
 * @param {{company?: string, history?: {work?: Array<{company?: string}>}}} copy
 */
export function formerEmployerAnswer(question, copy) {
  const asks = formerEmployerQuestion(question);
  if (!asks) return null;
  const company = asks.company || (asks.ours ? copy?.company : "") || "";
  if (!companyCore(company) || !copy?.history?.work?.length) return null;
  return inHistory(company, copy.history) ? "Yes" : "No";
}
