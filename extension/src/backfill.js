// Passive detail backfill — the decision logic, kept pure for unit tests.
//
// The flow: a job saved from a feed is often "thin" (title/company only). When
// the user later opens the ACTUAL job page — which they naturally do before
// applying — the content script captures the full posting. If the backend said
// this job is saved-but-thin (checkSaved → needs_details), we quietly send the
// full details up. Zero clicks; the tracker heals itself as you browse.
//
// This is CAPTURE, not scraping: we only ever read pages the user has open.

// A description shorter than this is a snippet, not the real posting — don't
// bother the server with it. (Mirrors the backend's MIN_DESCRIPTION_CHARS.)
export const MIN_DESCRIPTION = 200;

/**
 * Should this capture be sent as a backfill for an already-saved job?
 * @param {{title?: string, description?: string}} job   fresh capture from the page
 * @param {{saved?: boolean, needs_details?: boolean}} check   backend checkSaved result
 */
export function shouldBackfill(job, check) {
  return !!(
    check?.saved &&
    check?.needs_details &&
    job?.title &&
    (job.description || "").length >= MIN_DESCRIPTION
  );
}
