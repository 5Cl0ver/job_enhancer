/**
 * The words in every ⓘ bubble (spec 019, research R8), in one place so they
 * can be read and fixed together. Plain words: no IMAP, MCP or OAuth without
 * saying what it means. Each has what it is, why it helps, and what it needs.
 */
export interface Help {
  title: string;
  what: string;
  why: string;
  needs?: string;
  /** An in-app page with more, if there is one. */
  more?: string;
}

export const HELP = {
  matches: {
    title: "Matches",
    what: "New jobs that fit the searches you saved, gathered in one list.",
    why: "You don't have to run the same searches every day.",
    needs: "At least one saved search. Save one from Find Jobs.",
  },
  emailUpdates: {
    title: "Email updates",
    what: "Job Enhancer reads the job emails in your inbox (interviews, rejections, offers) and moves the job along for you.",
    why: "Your list stays up to date without you dragging anything.",
    needs: "An email account with an app password. Settings shows how, step by step.",
    more: "/settings#email",
  },
  aiApply: {
    title: "AI Apply",
    what: "Your résumés live here, and you can keep cover letters and résumé versions for each job.",
    why: "Everything for one application is in one place.",
    needs: "AI writing is paused for now. You can still upload résumés and save your own documents.",
  },
  autofill: {
    title: "Autofill memory",
    what: "Everything Job Catcher fills applications with: your profile, your résumé details and the answers it learned.",
    why: "Fix something once here and every application after uses it.",
    needs: "Job Catcher on your computer does the filling.",
    more: "/job-catcher",
  },
  analytics: {
    title: "Analytics",
    what: "How your search is going: jobs saved, applied, interviews, over time.",
    why: "See what's working and where things stall.",
  },
  jobCatcher: {
    title: "Job Catcher",
    what: "A Chrome add-on that saves jobs from any site and fills job applications for you.",
    why: "Applying takes seconds instead of half an hour of typing.",
    needs: "Chrome, Edge or Brave on a computer. Phones can't run it.",
  },
  scout: {
    title: "Claude Scout",
    what: "Your own Claude searches job sites for you and brings back jobs that fit your résumé.",
    why: "It reads far more postings than you have time for.",
    needs: "A Claude account connected to Job Enhancer. Settings › Claude shows how.",
    more: "/settings#claude",
  },
  stages: {
    title: "Stages",
    what: "The steps a job goes through: saved, applied, interview, offer and so on.",
    why: "One glance tells you where every application stands.",
    needs: "Nothing. You can rename or add stages to fit how you work.",
  },
  settingsClaude: {
    title: "Claude",
    what: "Connect your own Claude account so it can save jobs, read your profile and run Claude Scout.",
    why: "Claude can do the searching and drafting while you do other things.",
    needs: "A Claude account (any plan that can add connectors). Optional.",
  },
  settingsEmail: {
    title: "Email connection",
    what: "Lets Job Enhancer read job emails in one inbox to keep your jobs up to date.",
    why: "Interview invites and rejections move your jobs for you.",
    needs: "An app password: a separate password your email gives out for apps. We show you how to get one.",
  },
  settingsExport: {
    title: "Export",
    what: "A file with everything you keep in Job Enhancer.",
    why: "Your data is yours: keep a copy or take it elsewhere.",
  },
} satisfies Record<string, Help>;

export type HelpKey = keyof typeof HELP;
