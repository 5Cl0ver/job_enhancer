// The words in Job Catcher's ⓘ bubbles (spec 019). Same shape and tone as the
// app's frontend/src/lib/help.ts: what it is, why it helps, what it needs.
export interface Help {
  title: string;
  what: string;
  why: string;
  needs?: string;
}

export const HELP = {
  superAutofill: {
    title: "Super autofill",
    what: "After your first Autofill press, every next page of the same application fills by itself.",
    why: "Long applications (Workday, for example) go page after page without pressing each time.",
    needs: "Nothing. It never submits: you always press Submit yourself.",
  },
  pointAtBox: {
    title: "Point at a box",
    what: "Click any box on the page to see what Job Catcher thinks it is, and fix or teach the answer.",
    why: "Fix a box once and every application after fills it right.",
  },
  writeForJob: {
    title: "Write for this job",
    what: "A cover letter or résumé written for this one job.",
    why: "Tailored documents get more replies than one general version.",
    needs: "My Claude: your own Claude account. The free writer is paused for now.",
  },
} satisfies Record<string, Help>;

export type HelpKey = keyof typeof HELP;
