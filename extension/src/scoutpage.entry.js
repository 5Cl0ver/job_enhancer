// Claude Scout on any site: while a Scout run is open in the app, Claude in
// Chrome opens job pages on companies' own websites (a "Local companies" search)
// or wherever Google Jobs' "Apply on" links go. This sends each posting up
// word for word, the way content.entry.js does on Indeed / LinkedIn /
// ZipRecruiter (which run that script instead of this one).
//
// Nothing is read until the background says a Google Jobs or Local companies
// run is going (it asks the app at most every few seconds, cached for all
// tabs), and nothing is sent from a page that doesn't look like a job (see
// withPageFallback). The app checks the same again before keeping a copy.
import { extractJob } from "./extract/index.js";
import { SCOUT_MAX_FAILS, scoutDone, scoutPayload, withPageFallback } from "./scoutCapture.js";

const TICK_MS = 2500;
const TRIES_PER_PAGE = 20; // ~50s: long enough for a slow careers site to load

const sent = new Set(); // posting links the app has answered for
const fails = new Map(); // posting link -> failed sends
let inFlight = false;
let href = "";
let tries = 0;

function orphaned() {
  try {
    return !chrome.runtime?.id;
  } catch {
    return true;
  }
}

/** sendMessage that never throws synchronously (an orphaned script). */
function safeSend(msg) {
  try {
    return Promise.resolve(chrome.runtime.sendMessage(msg));
  } catch (e) {
    return Promise.reject(e);
  }
}

function tick() {
  if (orphaned()) {
    clearInterval(timer);
    return;
  }
  // A careers site that changes pages without reloading: start over.
  if (location.href !== href) {
    href = location.href;
    tries = 0;
  }
  if (inFlight || tries >= TRIES_PER_PAGE) return;
  tries += 1;
  inFlight = true;
  safeSend({ type: "scoutAnySite" })
    .then((res) => (res?.anySite ? capture() : null))
    .catch(() => {})
    .finally(() => {
      inFlight = false;
    });
}

/** Read the open page and send it, if it's a full job posting. */
function capture() {
  const job = withPageFallback(document, location.href, extractJob(document, location.href));
  const payload = scoutPayload(job);
  if (!payload || sent.has(payload.url)) return null;
  const link = payload.url;
  return safeSend({ type: "scoutCapture", job: payload })
    .then((res) => {
      if (scoutDone(res)) sent.add(link);
      else if (res?.failed) {
        const n = (fails.get(link) || 0) + 1;
        fails.set(link, n);
        if (n >= SCOUT_MAX_FAILS) sent.add(link);
      }
    });
}

const timer = setInterval(tick, TICK_MS);
setTimeout(tick, 800);
