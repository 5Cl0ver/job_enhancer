// "My jobs": the saved jobs, newest first, with Mark applied and a link to each.
import * as React from "react";
import { CheckCircle2, ExternalLink, RotateCw, Search } from "lucide-react";
import { Alert, Badge, Button, Input, Muted, SectionTitle, Spinner } from "@/ui";
import { appUrl, send } from "@/lib/chrome";
import { usePanel } from "@/lib/store";
import type { SavedJob } from "@/lib/context";

const SHOWN = 50;

export function MyJobs() {
  const { saved, reloadSaved } = usePanel();
  const [q, setQ] = React.useState("");
  const [retrying, setRetrying] = React.useState(false);

  const needle = q.trim().toLowerCase();
  const jobs = needle
    ? saved.jobs.filter((j) => `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(needle))
    : saved.jobs;

  async function retry() {
    setRetrying(true);
    await reloadSaved();
    setRetrying(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <SectionTitle>
          My jobs {saved.loaded && <span className="font-normal text-muted-foreground">({saved.jobs.length})</span>}
        </SectionTitle>
        <Button variant="link" size="sm" onClick={() => chrome.tabs.create({ url: `${appUrl()}/saved` })}>
          Open in the app
        </Button>
      </div>

      {saved.error && (
        <Alert tone="error">
          {saved.error}
          {saved.loaded ? " Showing the last list." : ""}{" "}
          <Button variant="link" size="sm" className="text-xs" onClick={retry} busy={retrying}>
            {!retrying && <RotateCw className="size-3!" />}Retry
          </Button>
        </Alert>
      )}

      {!saved.loaded && !saved.error && <Spinner label="Loading your jobs…" />}

      {saved.loaded && saved.jobs.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input aria-label="Search my jobs" placeholder="Search title or company" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}

      {saved.loaded && saved.jobs.length === 0 && (
        <Muted className="py-8 text-center">No saved jobs yet. Open a posting and press Save this job.</Muted>
      )}

      {saved.loaded && saved.jobs.length > 0 && jobs.length === 0 && (
        <Muted className="py-4 text-center">No jobs match “{q}”.</Muted>
      )}

      <ul className="flex flex-col divide-y rounded-xl bg-card ring-1 ring-foreground/10 empty:hidden">
        {jobs.slice(0, SHOWN).map((j) => (
          <JobRow key={j.id} job={j} />
        ))}
      </ul>
      {jobs.length > SHOWN && <Muted className="text-center">Showing {SHOWN} of {jobs.length}. Search to find the rest.</Muted>}
    </div>
  );
}

function JobRow({ job }: { job: SavedJob }) {
  const { reloadSaved } = usePanel();
  const [busy, setBusy] = React.useState(false);

  async function markApplied() {
    setBusy(true);
    await send({ type: "markApplied", job: { id: job.id, title: job.title, company: job.company } });
    await reloadSaved();
    setBusy(false);
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{job.title || "Untitled"}</p>
        <p className="truncate text-xs text-muted-foreground">{[job.company, job.location].filter(Boolean).join(" · ")}</p>
      </div>
      {job.applied ? (
        <Badge variant="success">
          <CheckCircle2 aria-hidden /> Applied
        </Badge>
      ) : (
        <Button variant="outline" size="sm" onClick={markApplied} busy={busy} title="Move this job to Applied" aria-label={`Mark ${job.title} applied`}>
          Mark applied
        </Button>
      )}
      {job.url && (
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${job.title}`}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink className="size-4" aria-hidden />
        </a>
      )}
    </li>
  );
}
