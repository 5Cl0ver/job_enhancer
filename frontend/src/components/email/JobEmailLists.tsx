/**
 * Two lists on Email updates (spec 027):
 * - New emails on your jobs: emails kept on a saved job you haven't opened
 *   yet (an interview email while the card is already in Interview, a "we
 *   received your application"…). Each opens its job.
 * - Looked at, not shown: job-looking emails the scan didn't put on a job,
 *   with the reason, for 30 days, so nothing disappears silently. "This is
 *   about my job" puts one on the job you pick.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmailViewer } from "@/components/email/EmailViewer";
import { useKeepOnJob, useLookedAt, useNewOnJobs, type DetectedEvent } from "@/hooks/useEmailAccount";
import { useSavedJobs } from "@/hooks/useSavedJobs";
import { emailWhen } from "@/lib/emailUpdates";
import { kindOf } from "@/lib/emailSections";
import { cn } from "@/lib/utils";

export function NewOnYourJobs() {
  const { data: rows = [] } = useNewOnJobs();
  if (!rows.length) return null;
  return (
    <section className="mb-8" aria-label="New emails on your jobs">
      <h2 className="mb-1 text-base font-semibold">New emails on your jobs ({rows.length})</h2>
      <p className="mb-3 text-xs text-muted-foreground">No card needed to move. Open the job to read them.</p>
      <ul className="space-y-2">
        {rows.map((ev) => (
          <li key={ev.id}>
            <Link
              to={ev.job_listing_id ? `/jobs/${ev.job_listing_id}` : "/email-updates"}
              className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-primary/40 bg-card px-3 py-2.5 hover:bg-muted/50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {kindOf(ev)}: {[ev.title, ev.company].filter(Boolean).join(" at ")}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {ev.subject} · {emailWhen(ev)}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-primary">Open job</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const REASON: Record<string, string> = {
  job_alert: "Looks like a job alert",
  digest: "Looks like a list of jobs",
  no_saved_job: "Not one of your saved jobs",
};

function KeepPicker({ ev, onDone }: { ev: DetectedEvent; onDone: () => void }) {
  const { data: saved = [] } = useSavedJobs();
  const keep = useKeepOnJob();
  const [jobId, setJobId] = useState("");
  const jobs = saved.filter((sj) => !sj.is_archived);
  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
      <select
        aria-label="Which saved job is this email about?"
        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm pointer-coarse:h-11 pointer-coarse:text-base"
        value={jobId}
        onChange={(e) => setJobId(e.target.value)}
      >
        <option value="">Pick the job…</option>
        {jobs.map((sj) => (
          <option key={sj.id} value={sj.id}>
            {sj.job_listing.title} · {sj.job_listing.company}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        className="pointer-coarse:h-11"
        disabled={!jobId || keep.isPending}
        onClick={() => keep.mutate({ id: ev.id, savedJobId: jobId }, { onSuccess: onDone })}
      >
        Put it there
      </Button>
      {keep.isError && <p className="text-xs text-destructive">Couldn't do that. Try again.</p>}
    </div>
  );
}

function LookedAtRow({ ev, onView }: { ev: DetectedEvent; onView: () => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <li className="rounded-lg border bg-card px-3 py-2.5">
      <p className="truncate text-sm">{ev.subject || "(no subject)"}</p>
      <p className="truncate text-xs text-muted-foreground">
        {REASON[ev.skip_reason ?? ""] ?? "Not shown"} · {emailWhen(ev)}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="pointer-coarse:h-11" onClick={() => setPicking((p) => !p)}>
          This is about my job
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5 pointer-coarse:h-11" onClick={onView}>
          <Mail className="h-3.5 w-3.5" aria-hidden /> View email
        </Button>
      </div>
      {picking && <KeepPicker ev={ev} onDone={() => setPicking(false)} />}
    </li>
  );
}

export function LookedAtList() {
  const [open, setOpen] = useState(false);
  const { data: rows = [] } = useLookedAt();
  const [viewing, setViewing] = useState<DetectedEvent | null>(null);
  if (!rows.length) return null;
  return (
    <section className="mb-4 rounded-lg border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="text-sm font-medium">Looked at, not shown ({rows.length})</span>
          <span className="block text-xs text-muted-foreground">
            Job-looking emails from the last 30 days that weren't put on a job. If one is about your job, put it there.
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul className="space-y-2 border-t px-3 py-3">
          {rows.map((ev) => (
            <LookedAtRow key={ev.id} ev={ev} onView={() => setViewing(ev)} />
          ))}
        </ul>
      )}
      <EmailViewer
        eventId={viewing?.id ?? null}
        mailLink={viewing?.mail_link}
        searchLink={viewing?.mail_search_link}
        onClose={() => setViewing(null)}
      />
    </section>
  );
}
