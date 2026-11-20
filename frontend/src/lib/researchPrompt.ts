/**
 * The prompt "Research it with Claude" copies (pure).
 */
import type { JobListing } from "@/types/api";

/**
 * A paste-ready prompt for the user's own Claude Project (which already has
 * their résumé in its knowledge). It leads with a READY-TO-SEND outreach email
 * grounded in the résumé + the full job description, then who-to-email, where
 * else to apply, and contacts — tuned to the apply → email → track pipeline.
 */
export function buildResearchPrompt(j: JobListing): string {
  const where = j.location ? ` (${j.location})` : "";
  // Give Claude the real posting so the email is tailored, not generic. Cap it
  // so a huge description doesn't blow up the prompt.
  const desc = j.description
    ? j.description.slice(0, 4000) + (j.description.length > 4000 ? "…" : "")
    : "(no description captured — infer from the title/company and note assumptions)";
  const link = j.apply_url ? `\nJob link: ${j.apply_url}` : "";

  return `I'm applying for the ${j.title} role at ${j.company}${where}. Use MY RÉSUMÉ from this project's knowledge — do not invent any experience I don't have. Give me a QUICK-SCAN brief with short headers and tables so I can read → confirm → send fast.

--- THE JOB ---
Title: ${j.title}
Company: ${j.company}${where}${link}
Description:
${desc}
--- END JOB ---

1. READY-TO-SEND EMAIL  (put this FIRST — I want to copy-paste and send)
   - Write a short, specific outreach email from ME to the hiring team, tailored to THIS description and grounded in MY résumé (name 1–2 concrete things from my background that match what they need).
   - Give me: a Subject line, and a Body I can paste as-is. Keep it tight (120–160 words), confident, no fluff, no made-up facts.
   - If a real recipient name isn't known, address it generically ("Hi [Hiring Manager]") and tell me who to swap in.

2. WHO TO EMAIL  (make this dead easy)
   - Give a table: | Contact | Address / pattern | Notes | — the careers/recruiting inbox if there is one, plus the company's likely corporate email PATTERN (e.g. firstname.lastname@domain) so I can reach a real person.
   - Be honest: do NOT invent a specific person's address. Give the pattern and tell me to confirm the name first.

3. WHERE ELSE TO APPLY
   - Table: | Source | Link | Why | — everywhere this exact role is posted (company careers page, LinkedIn, Indeed, ZipRecruiter, Glassdoor). Say which listing is most complete and where it's best to apply (apply direct on the company site if it's listed there).
   - Also: other OPEN roles at ${j.company} I should apply to, and similar roles at nearby / competing companies worth a look.

4. FIND THE PERSON
   - Likely hiring-manager / team-lead titles for this role and the exact LinkedIn search terms to find the real human.

Keep everything concrete, skimmable, and true to my résumé.`;
}
