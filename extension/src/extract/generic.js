// Universal fallback for any site without JSON-LD or a dedicated parser.
// Deliberately conservative: a title we're fairly sure about (og:title / h1)
// and a remote guess. Company/location are left blank for the user to fill in
// the side-panel form rather than guessed wrong from page chrome.
import { textFrom, looksRemote, clean } from "./util.js";

// Titles that are page chrome, never a real job — never auto-fill these.
const CHROME = /^(jobs?|careers?|search|sign in|log ?in|home|welcome|indeed|linkedin|glassdoor|ziprecruiter)\b/i;
// Search-results headings ("63 It Jobs (NOW HIRING) in Beaverton, OR") — a
// count followed by "jobs" is a list of jobs, never one job's title.
const SEARCH_HEADING = /^\d[\d,]*\+?\s.*\bjobs\b/i;
const notAJob = (t) => CHROME.test(t) || SEARCH_HEADING.test(t);

export function extractGeneric(doc, url) {
  let title = textFrom(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']);
  if (!title || notAJob(title)) {
    title = textFrom(doc, ["h1"]);
  }
  if (notAJob(title)) title = "";
  return {
    title: clean(title),
    company: "",
    location: "",
    // Title only — a full-page scan flags on-site jobs as Remote whenever ANY
    // other text on the page mentions remote (feed cards, footers, ads). This
    // guess is OR-ed with every other extractor's in mergeJob, so it must be
    // conservative.
    is_remote: looksRemote(title),
    url,
  };
}
