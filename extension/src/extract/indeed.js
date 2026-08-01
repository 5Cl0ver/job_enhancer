// Indeed detail-page (viewjob) selector fallback — used only when JSON-LD is
// absent or partial. These target the OPEN job page, not search cards, which is
// the reliable capture surface (one job, stable header markup).
import { textFrom, looksRemote } from "./util.js";

export function extractIndeed(doc, url) {
  const title = textFrom(doc, [
    "h1.jobsearch-JobInfoHeader-title",
    "[data-testid='jobsearch-JobInfoHeader-title']",
    "h2[data-testid='jobsearch-JobInfoHeader-title']",
    "h1 span[title]",
  ]);
  const company = textFrom(doc, [
    "[data-testid='inlineHeader-companyName'] a",
    "[data-testid='inlineHeader-companyName']",
    "[data-company-name='true']",
    ".jobsearch-CompanyInfoContainer a",
  ]);
  const location = textFrom(doc, [
    "[data-testid='inlineHeader-companyLocation']",
    "[data-testid='job-location']",
    ".jobsearch-JobInfoHeader-subtitle div:last-child",
  ]);
  const body = doc.body?.textContent || "";
  return { title, company, location, is_remote: looksRemote(location, title, body), url };
}
