// Saved-jobs sync for the side panel — a cheap change check, not a poll.
//
// The panel used to re-download the whole saved-jobs list (descriptions and
// all) every 15 s and on every focus. Now it asks the backend "has my list
// changed since version X?" (`GET /v1/saved-jobs/summary?version=X`). An
// unchanged answer is a few bytes and reads no rows; only a change returns the
// slim list (title, company, location, URL, applied date).
//
// Rules:
//   • Scheduled/focus checks run at most once per `minIntervalMs` (60 s), and
//     only while the panel is visible AND focused.
//   • A forced check (after a save, or the user pressing Retry) skips the
//     interval but still shares an in-flight request, so a save plus the
//     background's "jobSaved" ping cost one request, not two.
//   • Errors are reported to `onError`; the last good list stays on screen.
//
// Pure (clock, activity and fetch are injected) so it's unit-tested without a
// browser: see test/savedSync.spec.js.

export const MIN_INTERVAL_MS = 60_000;

/** Map the API's summary response to what the panel renders. */
export function parseSummary(data) {
  if (!data || typeof data.version !== "string") {
    return { error: "Unexpected response from the server." };
  }
  if (!data.changed) return { changed: false, version: data.version };
  const jobs = (Array.isArray(data.jobs) ? data.jobs : []).map((j) => ({
    id: j.id,
    job_listing_id: j.job_listing_id,
    title: j.title || "Untitled",
    company: j.company || "",
    location: j.location || "",
    url: j.url || "",
    applied: !!j.applied_at,
  }));
  return { changed: true, version: data.version, jobs };
}

/**
 * @param {object} deps
 * @param {(version: string|null) => Promise<object>} deps.fetchSummary
 *   resolves to {signedIn, changed?, version?, jobs?, error?}
 * @param {(jobs: object[]) => void} deps.onJobs     the list changed
 * @param {(message: string|null) => void} deps.onError  null clears the error
 * @param {() => void} [deps.onSignedOut]
 * @param {() => boolean} deps.isActive   panel visible and focused
 * @param {() => number} [deps.now]
 * @param {number} [deps.minIntervalMs]
 */
export function createSavedSync({
  fetchSummary,
  onJobs,
  onError,
  onSignedOut = () => {},
  isActive,
  now = () => Date.now(),
  minIntervalMs = MIN_INTERVAL_MS,
}) {
  let version = null;
  let lastCheck = -Infinity;
  let inFlight = null;

  async function run() {
    lastCheck = now();
    let res;
    try {
      res = await fetchSummary(version);
    } catch (e) {
      res = { signedIn: true, error: e?.message || "Network error" };
    }
    if (!res || res.signedIn === false) {
      onSignedOut();
      return "signed_out";
    }
    if (res.error) {
      onError(res.error);
      return "error";
    }
    onError(null);
    if (res.changed) {
      version = res.version;
      onJobs(res.jobs || []);
      return "changed";
    }
    return "unchanged";
  }

  /** Check for changes. Returns "skipped" | "changed" | "unchanged" | "error" | "signed_out". */
  function check({ force = false } = {}) {
    if (inFlight) return inFlight; // share the request already on the wire
    if (!force) {
      if (!isActive()) return Promise.resolve("skipped");
      if (now() - lastCheck < minIntervalMs) return Promise.resolve("skipped");
    }
    inFlight = run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    check,
    /** Forget the version so the next check downloads the list (e.g. sign-in). */
    reset() {
      version = null;
      lastCheck = -Infinity;
    },
    get version() {
      return version;
    },
  };
}
