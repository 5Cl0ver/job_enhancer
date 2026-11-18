// Claude Scout page copy — the decision logic, kept pure for unit tests.
//
// While a Claude Scout run is open in the app, Claude in Chrome opens job pages
// in this browser. The content script reads each one with the same tested
// extractJob() the Save button uses and sends it up, so the app saves the
// posting word for word instead of Claude retyping it. Nothing is sent when no
// run is open (the background checks), and only real postings are sent.
import { MIN_DESCRIPTION } from "./backfill.js";

/**
 * The capture to send for this job, or null when the page doesn't show a full
 * posting yet (still loading, a snippet, or not a job page).
 * @param {import("./extract/index.js").CapturedJob & Record<string, unknown>} job
 */
export function scoutPayload(job) {
  if (!job?.title || !job?.company || !job?.url) return null;
  if ((job.description || "").length < MIN_DESCRIPTION) return null;
  return {
    url: job.url,
    title: job.title,
    company: job.company,
    location: job.location || null,
    is_remote: !!job.is_remote,
    description: job.description,
    salary_min: job.salary_min ?? null,
    salary_max: job.salary_max ?? null,
    salary_period: job.salary_period || null,
    job_type: job.job_type || null,
    via: job._via || null,
  };
}

/**
 * Should the content script stop trying this job? Yes once the app stored it,
 * or once an open run turned it down (not a posting link). No while no run is
 * open, so a run that starts later still gets it.
 * @param {{active?: boolean, stored?: boolean} | undefined} res
 */
export function scoutDone(res) {
  return !!res?.active;
}
