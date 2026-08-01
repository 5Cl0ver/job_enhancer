// LinkedIn detail-page (/jobs/view/) selector fallback — used only when JSON-LD
// is absent or partial. Covers both the logged-out "guest" job page and the
// logged-in unified top card.
import { textFrom, looksRemote } from "./util.js";

export function extractLinkedIn(doc, url) {
  const title = textFrom(doc, [
    "h1.top-card-layout__title",
    ".job-details-jobs-unified-top-card__job-title",
    ".jobs-unified-top-card__job-title",
    "h1.topcard__title",
    "h1",
  ]);
  const company = textFrom(doc, [
    "a.topcard__org-name-link",
    ".topcard__org-name-link",
    ".job-details-jobs-unified-top-card__company-name a",
    ".job-details-jobs-unified-top-card__company-name",
    ".jobs-unified-top-card__company-name",
  ]);
  const location = textFrom(doc, [
    ".topcard__flavor--bullet",
    ".job-details-jobs-unified-top-card__bullet",
    ".jobs-unified-top-card__bullet",
    ".topcard__flavor-row .topcard__flavor:not(.topcard__flavor--metadata)",
  ]);
  const body = doc.body?.textContent || "";
  return { title, company, location, is_remote: looksRemote(location, title, body), url };
}
