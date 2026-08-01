// Injected on demand by the side panel's "Capture this page" button
// (via chrome.scripting.executeScript). Runs the shared extractor over whatever
// page is open, stashes the result in extension storage, and lets the side panel
// pick it up (it listens on chrome.storage.onChanged) to pre-fill the save form.
//
// This is the universal path: works on ANY site, not just Indeed/LinkedIn,
// because it falls back through JSON-LD → site selectors → generic og:title.
import { extractJob } from "./extract/index.js";

const job = extractJob(document, location.href);
chrome.storage.local.set({ je_capture: job });
