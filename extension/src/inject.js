// Pure DOM helpers for anchoring the Save button into a job detail header.
// Kept separate from content.entry.js (which is host-guarded and talks to
// chrome.*) so the fragile part — finding the title and placing the button —
// can be unit-tested against real saved job-page HTML.

export const INDEED_TITLE_SELECTORS = [
  "h1.jobsearch-JobInfoHeader-title",
  "[data-testid='jobsearch-JobInfoHeader-title']",
  "h2[data-testid='jobsearch-JobInfoHeader-title']",
  "h1 span[title]",
];

export const LINKEDIN_TITLE_SELECTORS = [
  ".top-card-layout__title",
  ".job-details-jobs-unified-top-card__job-title",
  ".jobs-unified-top-card__job-title",
  "h1.topcard__title",
];

/** First title element (with text) matching any selector, else null. */
export function findTitleEl(doc, selectors) {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.textContent.trim()) return el;
  }
  return null;
}

/** The heading to insert the button *after* (avoid nesting inside a span). */
export function headingFor(titleEl) {
  return titleEl.closest("h1, h2") || titleEl;
}
