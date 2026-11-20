// Claude Scout on any site: while a Scout run is open in the app, Claude in
// Chrome opens job pages on companies' own websites (a "Local companies" search)
// or wherever Google Jobs' "Apply on" links go. This sends each posting up
// word for word, the way content.entry.js does on Indeed / LinkedIn /
// ZipRecruiter (which run that script instead of this one).
//
// The background answers {active:false} without calling the app more than
// every few seconds when no run is open, and nothing is sent from a page that
// doesn't look like a job (see withPageFallback).
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
  const job = withPageFallback(document, location.href, extractJob(document, location.href));
  const payload = scoutPayload(job);
  if (!payload || sent.has(payload.url)) return;
  const link = payload.url;
  inFlight = true;
  safeSend({ type: "scoutCapture", job: payload })
    .then((res) => {
      if (scoutDone(res)) sent.add(link);
      else if (res?.failed) {
        const n = (fails.get(link) || 0) + 1;
        fails.set(link, n);
        if (n >= SCOUT_MAX_FAILS) sent.add(link);
      }
    })
    .catch(() => {})
    .finally(() => {
      inFlight = false;
    });
}

const timer = setInterval(tick, TICK_MS);
setTimeout(tick, 800);
