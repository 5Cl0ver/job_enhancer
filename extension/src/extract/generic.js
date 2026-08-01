// Universal fallback for any site without JSON-LD or a dedicated parser.
// Deliberately conservative: a title we're fairly sure about (og:title / h1)
// and a remote guess. Company/location are left blank for the user to fill in
// the side-panel form rather than guessed wrong from page chrome.
import { textFrom, looksRemote, clean } from "./util.js";

// Titles that are page chrome, never a real job — never auto-fill these.
const CHROME = /^(jobs?|careers?|search|sign in|log ?in|home|welcome|indeed|linkedin|glassdoor)\b/i;

export function extractGeneric(doc, url) {
  let title = textFrom(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']);
  if (!title || CHROME.test(title)) {
    title = textFrom(doc, ["h1"]);
  }
  if (CHROME.test(title)) title = "";
  const body = doc.body?.textContent || "";
  return {
    title: clean(title),
    company: "",
    location: "",
    is_remote: looksRemote(title, body),
    url,
  };
}
