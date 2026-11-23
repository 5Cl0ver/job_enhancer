// "This page": what Job Catcher can do on the tab beside it. One clear main
// action per kind of page: fill an application, save a posting, sync Indeed.
import * as React from "react";
import { CheckCircle2, ClipboardCheck, ExternalLink, FileText, MousePointerClick, PenLine, RefreshCw, Save, Zap } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, Muted, SectionTitle, Select, Switch, Textarea } from "@/ui";
import { bestJobMatch, findDuplicate, type SavedJob } from "@/lib/context";
import { send } from "@/lib/chrome";
import { usePanel } from "@/lib/store";
import { extractJobFromPage } from "@/lib/extractPage.js";

export function ThisPage({ onWrite }: { onWrite: (jobListingId: string) => void }) {
  const { tab, saved } = usePanel();
  const ctx = tab.ctx;
  const match = bestJobMatch(tab.title, saved.jobs);

  if (ctx.kind === "none") return <Elsewhere />;
  if (ctx.kind === "indeed-myjobs") return <IndeedSync />;
  return (
    <div className="flex flex-col gap-3">
      {ctx.kind === "application" && (
        <ApplyCard site={ctx.site} autoTracked={ctx.autoTracked} match={match} onWrite={onWrite} />
      )}
      <SaveJob compact={ctx.kind === "application"} site={ctx.site} match={match} />
    </div>
  );
}

// --- Applying ---------------------------------------------------------------

function ApplyCard({
  site,
  autoTracked,
  match,
  onWrite,
}: {
  site: string;
  autoTracked: boolean;
  match: SavedJob | null;
  onWrite: (id: string) => void;
}) {
  const { tab, reloadSaved } = usePanel();
  const [fill, setFill] = React.useState<"idle" | "busy" | "done" | "failed">("idle");
  const [marking, setMarking] = React.useState(false);

  async function autofill() {
    if (!tab.id) return;
    setFill("busy");
    let res = null;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { type: "runAutofill" });
    } catch {
      res = null;
    }
    setFill(res?.ok ? "done" : "failed");
  }

  async function markApplied() {
    if (!match) return;
    setMarking(true);
    await send({ type: "markApplied", job: { title: match.title, company: match.company } });
    await reloadSaved();
    setMarking(false);
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">Applying on {site}</span>
        <SectionTitle>{match ? match.title : "Application in progress"}</SectionTitle>
        <Muted>{match ? match.company : "Save the job below so it's tracked."}</Muted>
      </div>
      <Button onClick={autofill} busy={fill === "busy"} className="w-full">
        {fill !== "busy" && <Zap />}
        {fill === "busy" ? "Filling…" : "Autofill this page"}
      </Button>
      {fill === "done" && <Alert tone="success">Filled. Check every field on the page, then submit it yourself.</Alert>}
      {fill === "failed" && (
        <Alert tone="warning">Couldn't reach the page. Refresh it once, then try again.</Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {match?.applied ? (
          <Badge variant="success">
            <CheckCircle2 aria-hidden /> Tracked as applied
          </Badge>
        ) : match ? (
          <Button variant="outline" size="sm" onClick={markApplied} busy={marking}>
            {!marking && <ClipboardCheck />}I submitted it: mark applied
          </Button>
        ) : null}
        {match?.job_listing_id && (
          <Button variant="ghost" size="sm" onClick={() => onWrite(match.job_listing_id)}>
            <PenLine />
            Write for this job
          </Button>
        )}
      </div>
      <Muted>
        {autoTracked
          ? "Autofill never submits. When you submit, the job moves to Applied by itself."
          : "Autofill never submits. After you submit, press Mark applied."}
      </Muted>
    </Card>
  );
}

// --- Saving a posting -------------------------------------------------------

interface Draft {
  url: string;
  title: string;
  company: string;
  location: string;
  is_remote: boolean;
  salary_min: string;
  salary_max: string;
  salary_period: string;
  description: string;
}

type ReadJob = Partial<Omit<Draft, "salary_min" | "salary_max" | "salary_period">> & {
  salary_min?: number | null;
  salary_max?: number | null;
  salary_period?: string | null;
};

async function readPage(tabId: number): Promise<ReadJob | null> {
  // Indeed / LinkedIn / ZipRecruiter: the content script's tested extractJob().
  try {
    const viaContent = await chrome.tabs.sendMessage(tabId, { type: "extractJob" });
    if (viaContent?.ok && viaContent.job?.title) return viaContent.job as ReadJob;
  } catch {
    /* no content script here: read the page directly */
  }
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: extractJobFromPage });
    return (result?.result as ReadJob) ?? null;
  } catch {
    return null;
  }
}

function SaveJob({ compact, site, match }: { compact: boolean; site: string; match: SavedJob | null }) {
  const { tab, saved, reloadSaved, signedOut } = usePanel();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [reading, setReading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [note, setNote] = React.useState<{ tone: "info" | "success" | "warning" | "error"; text: string } | null>(null);
  const [open, setOpen] = React.useState(!compact);

  // A new page: start over.
  React.useEffect(() => {
    setDraft(null);
    setNote(null);
  }, [tab.url]);

  const dup = draft ? findDuplicate(draft, saved.jobs) : null;

  async function read() {
    if (!tab.id) return;
    setReading(true);
    setNote(null);
    const job = await readPage(tab.id);
    setReading(false);
    if (!job) {
      setNote({ tone: "error", text: "Can't read this page. Open the job posting as a normal page and try again." });
      return;
    }
    setDraft({
      url: job.url || tab.url,
      title: job.title || "",
      company: job.company || "",
      location: job.location || "",
      is_remote: !!job.is_remote,
      salary_min: job.salary_min ? String(job.salary_min) : "",
      salary_max: job.salary_max ? String(job.salary_max) : "",
      salary_period: job.salary_period || "",
      description: job.description || "",
    });
    if (!job.title || !job.company) setNote({ tone: "info", text: "Couldn't read much here. Fill in the details, then save." });
  }

  async function save() {
    if (!draft) return;
    if (!draft.title.trim() || !draft.company.trim()) {
      setNote({ tone: "warning", text: "Add at least a title and a company." });
      return;
    }
    const num = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    };
    setSaving(true);
    const res = await send({
      type: "saveJob",
      job: {
        url: draft.url || "https://job.capture",
        title: draft.title.trim(),
        company: draft.company.trim(),
        location: draft.location.trim() || "Not specified",
        is_remote: draft.is_remote,
        description: draft.description.trim() || null,
        salary_min: num(draft.salary_min),
        salary_max: num(draft.salary_max),
        salary_period: draft.salary_period || null,
      },
    });
    setSaving(false);
    if (res?.ok || res?.error === "Already in your tracker") {
      setNote({
        tone: "success",
        text: res?.ok ? `Saved: ${draft.title.trim()} at ${draft.company.trim()}` : "Already in My Jobs.",
      });
      setDraft(null);
      reloadSaved();
    } else if (res?.error === "NOT_SIGNED_IN") {
      signedOut();
    } else {
      setNote({ tone: "error", text: res?.error || "Couldn't save. Try again." });
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  if (compact && !open && !draft) {
    return match ? null : (
      <Button variant="link" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Not saved yet? Save this job
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      {!draft && (
        <>
          <div className="flex flex-col gap-0.5">
            <SectionTitle>Save this job</SectionTitle>
            <Muted>Reads the posting on {site} so you can check it, then saves it to My Jobs.</Muted>
          </div>
          <Button onClick={read} busy={reading} variant={compact ? "outline" : "default"} className="w-full">
            {!reading && <Save />}
            {reading ? "Reading the page…" : "Save this job"}
          </Button>
          <Muted className="flex items-center gap-1.5">
            <MousePointerClick className="size-3.5" aria-hidden />
            Tip: highlight the description first to save exactly that text.
          </Muted>
        </>
      )}

      {draft && (
        <div className="flex flex-col gap-2.5">
          <SectionTitle>Check the details</SectionTitle>
          {dup && (
            <Alert tone="warning">
              You already saved <b>{dup.title}</b> at {dup.company}. Saving again makes a second copy.
            </Alert>
          )}
          <Field label="Job title">{(id) => <Input id={id} value={draft.title} onChange={(e) => set("title", e.target.value)} />}</Field>
          <Field label="Company">{(id) => <Input id={id} value={draft.company} onChange={(e) => set("company", e.target.value)} />}</Field>
          <div className="flex items-end gap-3">
            <Field label="Location" className="flex-1">
              {(id) => <Input id={id} value={draft.location} onChange={(e) => set("location", e.target.value)} />}
            </Field>
            <label className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={draft.is_remote} onCheckedChange={(v) => set("is_remote", v)} label="Remote" />
              Remote
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Pay from">{(id) => <Input id={id} inputMode="numeric" value={draft.salary_min} onChange={(e) => set("salary_min", e.target.value)} />}</Field>
            <Field label="Pay to">{(id) => <Input id={id} inputMode="numeric" value={draft.salary_max} onChange={(e) => set("salary_max", e.target.value)} />}</Field>
            <Field label="Per">
              {(id) => (
                <Select id={id} value={draft.salary_period} onChange={(e) => set("salary_period", e.target.value)}>
                  <option value="">—</option>
                  <option value="yearly">Year</option>
                  <option value="hourly">Hour</option>
                </Select>
              )}
            </Field>
          </div>
          <Field label="Description">
            {(id) => <Textarea id={id} rows={6} value={draft.description} onChange={(e) => set("description", e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <Button onClick={save} busy={saving} variant={dup ? "secondary" : "default"} className="flex-1">
              {!saving && <Save />}
              {dup ? "Save a second copy" : "Save to My Jobs"}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {note && <Alert tone={note.tone}>{note.text}</Alert>}
    </Card>
  );
}

// --- Indeed "My jobs" -------------------------------------------------------

const STAGES = ["Interested", "Referral Sent", "Applied", "Phone Screen", "Take-Home Assignment", "Interview", "Offer", "Rejected"];

interface App {
  title: string;
  company: string;
  location?: string;
  url?: string;
  status?: string;
  stage?: string;
}
type Row = App & { keep: boolean; chosen: string };
type Outcome = { action: "updated" | "imported" | "skipped"; title: string; company: string; stage?: string };

function IndeedSync() {
  const { tab, reloadSaved, signedOut } = usePanel();
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [busy, setBusy] = React.useState<"read" | "sync" | null>(null);
  const [note, setNote] = React.useState<string>("");
  const [result, setResult] = React.useState<{ updated: number; imported: number; skipped: number; outcomes: Outcome[] } | null>(null);

  async function read() {
    if (!tab.id) return;
    setBusy("read");
    setNote("");
    setResult(null);
    let res = null;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { type: "readApplications" });
    } catch {
      res = null;
    }
    setBusy(null);
    if (!res) return setNote("Couldn't reach the Indeed tab. Refresh it once, then try again.");
    if (!res.ok || !res.applications?.length)
      return setNote("No applications found. Open Indeed › My jobs › Applied, then try again.");
    setRows((res.applications as App[]).map((a) => ({ ...a, keep: true, chosen: a.stage || "Applied" })));
  }

  async function sync() {
    const items = (rows || [])
      .filter((r) => r.keep)
      .map((r) => ({ title: r.title, company: r.company, location: r.location || "Not specified", url: r.url || undefined, stage: r.chosen }));
    if (!items.length) return setNote("Tick at least one application.");
    setBusy("sync");
    const res = await send({ type: "syncApplications", applications: items });
    setBusy(null);
    if (res?.error === "NOT_SIGNED_IN") return signedOut();
    if (!res?.ok) return setNote(`Couldn't sync: ${res?.error || "unknown error"}`);
    setRows(null);
    setResult({ updated: res.updated || 0, imported: res.imported || 0, skipped: res.skipped || 0, outcomes: res.outcomes || [] });
    reloadSaved();
  }

  const picked = rows?.filter((r) => r.keep).length ?? 0;
  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">Indeed · My jobs</span>
        <SectionTitle>Sync your applications</SectionTitle>
        <Muted>Brings each application's status into My Jobs. You check the list first.</Muted>
      </div>
      {!rows && (
        <Button onClick={read} busy={busy === "read"} className="w-full">
          {busy !== "read" && <RefreshCw />}
          {busy === "read" ? "Reading the page…" : "Read my Indeed applications"}
        </Button>
      )}
      {rows && (
        <>
          <ul className="flex flex-col divide-y rounded-lg ring-1 ring-foreground/10">
            {rows.map((r, i) => (
              <li key={`${r.title}-${r.company}-${i}`} className="flex flex-col gap-1.5 p-2.5">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                    checked={r.keep}
                    onChange={(e) => update(i, { keep: e.target.checked })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[r.company, r.location].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Badge variant="secondary">{r.status || "Applied"}</Badge>
                </label>
                <Select aria-label={`Stage for ${r.title}`} value={r.chosen} onChange={(e) => update(i, { chosen: e.target.value })} className="ml-6 w-auto">
                  {STAGES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button onClick={sync} busy={busy === "sync"} className="flex-1">
              Sync {picked}
            </Button>
            <Button variant="ghost" onClick={() => setRows(null)}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {note && <Alert tone="warning">{note}</Alert>}
      {result && (
        <div className="flex flex-col gap-2">
          <Alert tone="success">
            {result.updated} updated · {result.imported} added{result.skipped ? ` · ${result.skipped} skipped` : ""}
          </Alert>
          {(["updated", "imported", "skipped"] as const).map((action) => {
            const items = result.outcomes.filter((o) => o.action === action);
            if (!items.length) return null;
            const label = { updated: "Already tracked, updated", imported: "New to My Jobs", skipped: "Skipped" }[action];
            return (
              <div key={action} className="flex flex-col gap-1">
                <Muted className="font-medium">
                  {label} ({items.length})
                </Muted>
                {items.map((o, i) => (
                  <p key={i} className="truncate text-xs">
                    {o.title} · {o.company}
                    {action !== "skipped" && o.stage ? ` → ${o.stage}` : ""}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// --- Nothing to do here -----------------------------------------------------

function Elsewhere() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
        <FileText className="size-5" aria-hidden />
      </span>
      <SectionTitle>Open a job or an application</SectionTitle>
      <Muted className="max-w-64">
        On a job posting, Job Catcher saves it to My Jobs. On an application form, it fills in your details for you to check.
      </Muted>
      <Muted className="flex items-center gap-1">
        <ExternalLink className="size-3" aria-hidden /> Works on any job site.
      </Muted>
    </div>
  );
}
