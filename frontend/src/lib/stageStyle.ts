/**
 * One colour per kind of stage, so a job's stage reads at a glance wherever it
 * shows (rows, chips, the stage picker). Matched on the stage's name, so custom
 * stages such as "Final interview" or "Coding challenge" get a sensible colour.
 */
export interface StageTone {
  /** A small filled chip: tinted background, readable text. */
  chip: string;
  /** A solid dot in the same colour. */
  dot: string;
}

const TONES = {
  slate: {
    chip: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  purple: {
    chip: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
    dot: "bg-purple-500",
  },
  blue: { chip: "bg-blue-500/15 text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  cyan: { chip: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300", dot: "bg-cyan-500" },
  amber: {
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  orange: {
    chip: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  green: {
    chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  red: { chip: "bg-red-500/15 text-red-700 dark:text-red-300", dot: "bg-red-500" },
} satisfies Record<string, StageTone>;

// First match wins, so the more specific names come first.
const RULES: [RegExp, StageTone][] = [
  [/reject|declin|withdraw|ghost|closed|not moving/i, TONES.red],
  [/offer|hired|accepted/i, TONES.green],
  [/take[-\s]?home|assessment|assignment|coding|challenge|test/i, TONES.amber],
  [/phone|screen/i, TONES.cyan],
  [/interview|onsite|on-?site|final|technical/i, TONES.orange],
  [/referr|contact/i, TONES.purple],
  [/appl|submitted|review/i, TONES.blue],
];

export function stageTone(name: string | null | undefined): StageTone {
  if (!name) return TONES.slate;
  return RULES.find(([pattern]) => pattern.test(name))?.[1] ?? TONES.slate;
}
