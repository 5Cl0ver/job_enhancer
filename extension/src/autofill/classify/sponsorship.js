// Is a question asking about visa sponsorship, and which way round? PURE:
// unit-tested in test/bug-fixes-036.spec.js (spec 036).
//
// Only the ASKING part counts: text in brackets, "Note: …", "Please answer
// No if …", "We are unable to sponsor." and the like are help text, and a
// passing mention ("this role does not offer visa sponsorship") never makes
// a work-authorization question a sponsorship one. When the wording isn't
// clearly one way round, the question is left for the user — never a guess.

/** Words that make it about sponsorship (a visa for work counts). */
const SPONSOR = /sponsor|\bvisa\b[^?.]{0,30}\b(work|employ|support)|\b(work|employment|immigration) visa\b/i;
const AUTH_WORDS = /authori[sz]|legally|eligib|right to work|lawfully/i;

// "…without sponsorship", "…not require sponsorship", "sponsorship not required".
// The "without"/"not" must belong to the same clause as the ask: never across
// a comma or semicolon, and never past a new "will you / do you…" — so a
// lead-in like "Not including OPT, will you require sponsorship?" is still
// asked the straight way.
const SAME_CLAUSE = "(?:(?!\\b(?:will|do|does|would|are|can|is)\\s+you\\b)[^?,;])";
const REVERSED = new RegExp(
  `\\bwithout\\b${SAME_CLAUSE}{0,40}\\b(sponsor|visa)` +
    `|\\b(not|never)\\b${SAME_CLAUSE}{0,25}\\b(requir|need)\\w*${SAME_CLAUSE}{0,30}\\b(sponsor|visa)` +
    `|\\bsponsor\\w*[^?]{0,25}\\bnot (be )?(required|needed)`,
  "i",
);
// A direct ask: "Will you (now or in the future) require…", "Do you need…",
// "Is sponsorship required…" — with no "not" before its verb.
const DIRECT = /\b(will|do|does|would|is|are|did)\b(?:(?!\bnot\b|\bnever\b|n['’]t\b)[^?]){0,60}?\b(requir|need)\w*/i;
// A short label that is the question: "Visa sponsorship required?", "Sponsorship".
const LABEL = /^\W*((visa|immigration|employment|work)\s+)*(visa\s+)?sponsorship(\s+(required|needed|requirements?))?\W*$/i;

// Help text: sentences that explain rather than ask.
const HELP_SENTENCE =
  /^\W*(note|please|if|we|our|this|these|the (company|employer|position|role)|candidates?|applicants?|sponsorship (is|will)|position|role|answer|select|choose|for this|unfortunately)\b/i;
// A help clause inside a sentence: " - please answer…", "if you…", "please note…".
const HELP_CLAUSE = /\s*(?:[-–—:,]\s*)?\b(please (answer|select|choose|note|indicate)|if (you|not|yes|no|so)\b|note:).*$/i;

/** Sentences, never split inside "U.S." or "e.g.". */
function sentences(text) {
  return text
    .split(/(?<=[.!?:])\s+(?=[A-Z][a-z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The asking part of a question: brackets and help text gone. */
export function askingPart(question) {
  const plain = String(question || "")
    .replace(/\([^)]*\)?|\[[^\]]*\]?/g, " ")
    .replace(/\*+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const all = sentences(plain);
  const asks = all.filter((s) => s.endsWith("?"));
  const kept = (asks.length ? asks : all.filter((s) => !HELP_SENTENCE.test(s)))
    .map((s) => s.replace(HELP_CLAUSE, "").trim())
    .filter((s) => s.replace(/\W+/g, ""));
  return kept.join(" ");
}

// Each ask inside one: "…, and will you …", "… and not require …".
const ANOTHER_ASK =
  /,?\s*\b(?:and|or)\s+(?=(?:(?:will|do|would|are|have|can)\s+you\b|(?:do\s+)?not\b|never\b|don['’]t\b)|(?:\w+\s+){0,2}(?:requir|need)\w*\s+(?:\w+\s+){0,2}sponsor)/i;

/**
 * "requires_sponsorship", "no_sponsorship_needed" (the question asked the
 * other way round), null (two questions in one, or a sponsorship question
 * not clearly asked either way: the user's), or undefined (not about
 * sponsorship: work authorization and the rest go on as usual).
 */
export function sponsorshipKey(question) {
  const ask = askingPart(question);
  if (!SPONSOR.test(ask)) return undefined;
  const parts = ask.split(/(?<=\?)\s*/).flatMap((s) => s.split(ANOTHER_ASK)).filter((s) => s.trim());
  const sponsorParts = parts.filter((p) => SPONSOR.test(p));
  if (sponsorParts.length && parts.some((p) => AUTH_WORDS.test(p) && !SPONSOR.test(p))) return null; // two in one
  if (sponsorParts.length > 1) return null;
  const s = sponsorParts[0] || ask;
  const rev = REVERSED.exec(s);
  const direct = DIRECT.exec(s);
  // Reversed, unless a plain "do you require…" comes first ("Will you
  // require sponsorship, or not?" is still asked the straight way).
  if (rev && !(direct && direct.index + direct[0].length <= rev.index)) return "no_sponsorship_needed";
  if (direct || LABEL.test(s)) return "requires_sponsorship";
  // Only mentioned ("this role does not offer sponsorship"): not the question.
  return AUTH_WORDS.test(s) ? undefined : null;
}
