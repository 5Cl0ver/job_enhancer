import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Copy,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BugForm } from "@/components/bugs/BugForm";
import { BugHistory } from "@/components/bugs/BugHistory";
import { BugLinks } from "@/components/bugs/BugLinks";
import { BugNotes } from "@/components/bugs/BugNotes";
import { SeverityPill, StatusPill } from "@/components/bugs/BugRow";
import { BugStatusMenu } from "@/components/bugs/BugStatusMenu";
import { ManualCopy, useCopy } from "@/components/bugs/CopyForClaude";
import { ReportPicker } from "@/components/bugs/ReportPicker";
import {
  type BugChange,
  useBugDetail,
  useDeleteBug,
  useMergeBug,
  useUpdateBug,
} from "@/hooks/useBugReports";
import {
  type BugDetail as Detail,
  type BugDraft,
  SECTION_LABEL,
  SOURCE_LABEL,
  saveErrorText,
  stepsCheck,
  stepsFrom,
  timesText,
} from "@/lib/bugs";
import { bugReport, utcTime } from "@/lib/bugReport";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <div className="text-sm">{children}</div>
    </div>
  );
}

const jobName = (job: { title: string; company: string }) =>
  [job.title, job.company].filter(Boolean).join(" at ") || "The job";

function draftOf(r: Detail): BugDraft {
  return {
    type: r.type,
    title: r.title,
    section: r.section,
    severity: r.severity ?? "major",
    actual: r.actual,
    expected: r.expected,
    steps: r.steps.join("\n"),
    place: r.place ?? "",
    box: r.box ?? "",
  };
}

/** Only what the owner changed, so the history shows only real changes. */
function changes(before: Detail, d: BugDraft): BugChange {
  const out: BugChange = {};
  if (d.type !== before.type) out.type = d.type;
  if (d.title.trim() !== before.title) out.title = d.title.trim();
  if (d.section !== before.section) out.section = d.section;
  if (d.type === "bug" && d.severity !== (before.severity ?? "major"))
    out.severity = d.severity;
  if (d.actual !== before.actual) out.actual = d.actual;
  if (d.type === "bug" && d.expected !== before.expected)
    out.expected = d.expected;
  const steps = stepsFrom(d.steps);
  if (steps.join("\n") !== before.steps.join("\n")) out.steps = steps;
  return out;
}

function EditSheet({
  report,
  open,
  onOpenChange,
}: {
  report: Detail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const update = useUpdateBug();
  // Mounted on each open, so it starts from the report as it is now.
  const [draft, setDraft] = useState<BugDraft>(() => draftOf(report));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit</DialogTitle>
          <DialogDescription className="sr-only">
            Change any field.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const change = changes(report, draft);
            if (!Object.keys(change).length) return onOpenChange(false);
            update.mutate(
              { id: report.id, ...change },
              { onSuccess: () => onOpenChange(false) },
            );
          }}
        >
          <BugForm
            idPrefix={`edit-${report.id}`}
            draft={draft}
            onChange={setDraft}
          />
          {update.isError && (
            <p role="alert" className="text-sm text-destructive">
              {saveErrorText(update.error)}
            </p>
          )}
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                !draft.title.trim() ||
                stepsCheck(draft.steps).tooLong !== null ||
                update.isPending
              }
              className="w-full md:w-auto"
            >
              {update.isPending && (
                <Loader2 className="animate-spin" aria-hidden />
              )}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The whole report: every field, notes, related reports and its history,
 * with everything the owner can do to it. A sheet on a phone, a side panel on
 * a computer (the page decides).
 */
export function BugDetail({
  id,
  onOpen,
  onGone,
}: {
  id: string;
  onOpen: (id: string) => void;
  onGone: () => void;
}) {
  const { data: r, isLoading, isError } = useBugDetail(id);
  const update = useUpdateBug();
  const remove = useDeleteBug();
  const merge = useMergeBug();
  const { copy, manual, clearManual } = useCopy();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [merging, setMerging] = useState(false);

  if (isLoading)
    return (
      <Loader2
        className="mx-auto my-8 h-6 w-6 animate-spin text-muted-foreground"
        aria-label="Loading"
      />
    );
  if (isError || !r)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        This report is gone.
      </p>
    );

  const bug = r.type === "bug";
  const c = r.context ?? {};
  const filled = [
    c.device,
    c.browser,
    c.theme,
    c.app_version && `app ${c.app_version}`,
    c.job_catcher && `Job Catcher ${c.job_catcher}`,
    c.playbook && `playbook ${c.playbook}`,
  ].filter(Boolean);

  return (
    <article aria-label={r.title} className="space-y-5">
      <header className="space-y-2">
        <h2 className="break-words pr-10 text-lg font-semibold leading-snug md:pr-0">
          {r.title}
        </h2>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {bug ? "Bug" : "Idea"}
          </span>
          <SeverityPill severity={bug ? r.severity : null} />
          <StatusPill status={r.status} />
          <span>{SECTION_LABEL[r.section]}</span>
          <span aria-hidden>·</span>
          <span>{SOURCE_LABEL[r.source]}</span>
          {r.confidence === "not_sure" && <span>(not sure)</span>}
        </p>
      </header>

      {r.needs_check && (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm font-medium">
            Fixed by Claude: needs your check
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => update.mutate({ id: r.id, checked: true })}
              disabled={update.isPending}
            >
              Looks fixed
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => update.mutate({ id: r.id, status: "new" })}
              disabled={update.isPending}
            >
              Reopen
            </Button>
          </div>
        </div>
      )}
      {r.came_back_at && (
        <p className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <RotateCcw className="h-4 w-4 shrink-0" aria-hidden />
          Came back {utcTime(r.came_back_at)}
          {r.fixed_in ? ` after the ${r.fixed_in} fix` : ""}
        </p>
      )}
      {r.status === "fixed" && r.fixed_in && !r.came_back_at && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300">
          Fixed in {r.fixed_in}
        </p>
      )}

      <BugStatusMenu report={r} />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => copy(bugReport(r))}>
          <Copy aria-hidden /> Copy for Claude
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          <Pencil aria-hidden /> <span className="max-sm:sr-only">Edit</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => update.mutate({ id: r.id, pinned: !r.pinned })}
          aria-pressed={r.pinned}
        >
          {r.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
          <span className="max-sm:sr-only">{r.pinned ? "Unpin" : "Pin"}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="More">
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setMerging(true)}>
              Same as another…
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => setDeleting(true)}
            >
              <Trash2 aria-hidden /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {update.isError && !editing && (
        <p role="alert" className="text-sm text-destructive">
          {saveErrorText(update.error)}
        </p>
      )}
      {manual !== null && <ManualCopy text={manual} onClose={clearManual} />}

      {r.actual && (
        <Field label={bug ? "What happened" : "The idea"}>
          <p className="whitespace-pre-wrap break-words">{r.actual}</p>
        </Field>
      )}
      {bug && r.expected && (
        <Field label="What you expected">
          <p className="whitespace-pre-wrap break-words">{r.expected}</p>
        </Field>
      )}
      {r.steps.length > 0 && (
        <Field label="Steps">
          <ol className="list-decimal space-y-0.5 pl-5">
            {r.steps.map((s, i) => (
              <li key={i} className="break-words">
                {s}
              </li>
            ))}
          </ol>
        </Field>
      )}
      {(r.place || r.box) && (
        <Field label="Where">
          {r.place && <p className="break-all font-mono text-xs">{r.place}</p>}
          {r.box && <p className="break-words">Box: {r.box}</p>}
        </Field>
      )}
      <Field label="Seen">
        <p>
          {timesText(r.count)}
          {r.count > 1
            ? `, first ${utcTime(r.first_seen)}, last ${utcTime(r.last_seen)}`
            : `, ${utcTime(r.last_seen)}`}
        </p>
      </Field>
      {(filled.length > 0 || r.run || r.job) && (
        <Field label="Filled in">
          <ul className="flex flex-wrap gap-1.5">
            {filled.map((v) => (
              <li
                key={v as string}
                className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {v}
              </li>
            ))}
          </ul>
          {(r.run || r.job) && (
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {r.job &&
                (r.job.own ? (
                  <Link
                    to={`/jobs/${r.job.id}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {jobName(r.job)}
                  </Link>
                ) : (
                  <span>{jobName(r.job)} (someone else's job)</span>
                ))}
              {r.run &&
                (r.run.own ? (
                  <Link
                    to={`/apply/${r.run.id}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    The run
                  </Link>
                ) : (
                  <span>Someone else's run</span>
                ))}
            </p>
          )}
        </Field>
      )}

      <BugNotes id={r.id} events={r.events} />
      <BugLinks report={r} onOpen={onOpen} />
      <BugHistory id={r.id} events={r.events} />

      {editing && <EditSheet report={r} open onOpenChange={setEditing} />}
      <ReportPicker
        open={merging}
        onOpenChange={setMerging}
        title="Same as another report"
        hint="This one goes into the one you pick and its count is added. You can split it back."
        startType={r.type}
        exclude={[r.id]}
        error={
          merge.isError
            ? (merge.error as Error).message ||
              "Couldn't merge them. Try again."
            : null
        }
        onPick={(intoId) =>
          merge.mutate(
            { id: r.id, intoId },
            {
              onSuccess: () => {
                setMerging(false);
                onOpen(intoId);
              },
            },
          )
        }
      />
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="md:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete for good?</DialogTitle>
            <DialogDescription>
              Its notes and history go too. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleting(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(r.id, {
                  onSuccess: () => {
                    setDeleting(false);
                    onGone();
                  },
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
