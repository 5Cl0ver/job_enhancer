// Language levels (spec 020, US4). The profile keeps each language's levels
// from 1 (beginner) to 5 (fluent/native); sites word their options their own
// way ("5 - Fluent", "Native or bilingual proficiency", "Advanced", "High").
// Numbered options are matched by number (rescaled to the site's scale);
// otherwise each option's words say which level it is and the nearest wins,
// a tie going to the lower one (never overstate). Options that don't read as
// levels are never guessed. Sources: research R6 (LinkedIn/ILR levels,
// Workday tenants' scales). PURE: test/languages.spec.js.
import { isPlaceholderOption } from "./answers.js";

export const ABILITIES = ["comprehension", "reading", "speaking", "writing", "overall"];

/** Which ability a level box asks about, from its label. */
export function abilityOf(label) {
  const s = String(label || "");
  if (/comprehen|listen|understand/i.test(s)) return "comprehension";
  if (/\bread/i.test(s)) return "reading";
  if (/speak|spoken|oral|conversation/i.test(s)) return "speaking";
  if (/writ/i.test(s)) return "writing";
  return "overall";
}

/** The level (1–5) for one ability: its own, else overall, else 5 for a native language. */
export function levelFor(entry, ability) {
  if (!entry) return null;
  const own = Number(entry[ability]);
  if (own >= 1 && own <= 5) return own;
  const all = Number(entry.overall);
  if (all >= 1 && all <= 5) return all;
  return entry.native ? 5 : null;
}

// Words → level, most specific first ("full professional" before "professional").
const LADDER = [
  [5, /native|bilingual|mother tongue|first language|complete mastery|\bfluent\b|\bexpert\b|excellent/i],
  [4, /full professional|advanced|proficient|very good|superior|\bhigh\b/i],
  // ("Limited working" is 2: checked before "working" reads as 3.)
  [2, /limited|basic|\bfair\b|classroom/i],
  [3, /professional working|intermediate|conversational|\bgood\b|medium|average|\bworking\b/i],
  [1, /beginner|elementary|minimal|novice|\blow\b|no proficiency/i],
];

function wordLevel(label) {
  for (const [level, re] of LADDER) if (re.test(label)) return level;
  return null;
}

/**
 * The index of the option for `level` (1–5), or -1.
 * @param {number|null} level
 * @param {{label: string}[]} options
 */
export function levelOption(level, options) {
  if (!(level >= 1 && level <= 5) || !options?.length) return -1;
  const real = options.map((o, i) => ({ i, label: String(o.label || "").trim() })).filter((o) => o.label && !isPlaceholderOption(o.label));
  // "1 - Beginner" … numbered: by number, rescaled to the site's scale.
  const numbered = real.map((o) => ({ ...o, n: Number(/^\s*(\d+)\s*[-–.:)]/.exec(o.label)?.[1]) })).filter((o) => o.n >= 0);
  if (numbered.length >= 2 && numbered.length === real.length) {
    const top = Math.max(...numbered.map((o) => o.n));
    const want = Math.max(1, Math.min(top, Math.round((level * top) / 5)));
    return nearest(numbered.map((o) => ({ i: o.i, level: o.n })), want);
  }
  const worded = real.map((o) => ({ i: o.i, level: wordLevel(o.label) })).filter((o) => o.level != null);
  return worded.length ? nearest(worded, level) : -1;
}

function nearest(list, want) {
  let best = null;
  for (const o of list) {
    const d = Math.abs(o.level - want);
    if (!best || d < best.d || (d === best.d && o.level < best.level)) best = { ...o, d };
  }
  return best ? best.i : -1;
}
