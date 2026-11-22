/**
 * Say which saved job an email is really about (spec 013).
 *
 * `JobPicker` lists the user's saved jobs, likeliest first, with a search box.
 * `SameJobButton` uses it on a job made from an email: the copy folds into
 * the real job (its emails move there, the card moves forward), with Undo.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { errorText } from "@/components/scout/errorText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  useLinkJob,
  useLinkOptions,
  useUnlinkJob,
  type JobOption,
  type LinkResult,
  type LinkSource,
} from "@/hooks/useJobLinks";
import type { SavedJob } from "@/types/api";

/** How many jobs show before "Show all" (likely ones always show). */
const SHOWN = 6;

function OptionRow({
  o,
  disabled,
  onPick,
}: {
  o: JobOption;
  disabled: boolean;
  onPick: (o: JobOption) => void;
}) {
  const facts = [o.company, o.location, o.stage].filter(Boolean).join(" · ");
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPick(o)}
        className="flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-60 pointer-coarse:py-3"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{o.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{facts}</span>
        </span>
        {o.likely && (
          <Badge variant="secondary" className="shrink-0">
            Likely
          </Badge>
        )}
      </button>
    </li>
  );
}

/** The user's saved jobs to choose from, likeliest first. */
export function JobPicker({
  source,
  open,
  onOpenChange,
  title,
  description,
  onPick,
  busy = false,
  error = null,
  footer,
}: {
  source: LinkSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onPick: (o: JobOption) => void;
  busy?: boolean;
  error?: string | null;
  footer?: ReactNode;
}) {
  const { data: options = [], isLoading, isError } = useLinkOptions(source, open);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q)
      return options.filter((o) =>
        `${o.title} ${o.company} ${o.location ?? ""}`.toLowerCase().includes(q),
      );
    if (all) return options;
    const likely = options.filter((o) => o.likely).length;
    return options.slice(0, Math.max(SHOWN, likely));
  }, [options, query, all]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Search your jobs"
            placeholder="Search your jobs"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your jobs…
          </p>
        ) : isError ? (
          <p className="text-sm text-destructive">Couldn&apos;t load your jobs. Try again.</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {query ? "No saved job matches that." : "You have no other saved jobs."}
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Your jobs">
            {shown.map((o) => (
              <OptionRow key={o.saved_job_id} o={o} disabled={busy} onPick={onPick} />
            ))}
          </ul>
        )}
        {!query && !all && options.length > shown.length && (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(true)}>
            Show all {options.length}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {footer && <DialogFooter className="gap-2">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

/** "Same job as…" on a job made from an email. */
export function SameJobButton({
  savedJob,
  onLinked,
}: {
  savedJob: Pick<SavedJob, "id" | "origin">;
  onLinked?: (result: LinkResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const link = useLinkJob();
  const unlink = useUnlinkJob();
  if (savedJob.origin !== "email") return null;

  const pick = (o: JobOption) =>
    link.mutate(
      { id: savedJob.id, targetId: o.saved_job_id },
      {
        onSuccess: (result) => {
          setOpen(false);
          toast.success(
            `Linked to ${o.title}${result.stage ? `, now in ${result.stage}` : ""}.`,
            {
              action: {
                label: "Undo",
                onClick: () =>
                  unlink.mutate(
                    { id: savedJob.id, undo: result.undo },
                    { onError: () => toast.error("Couldn't undo that. Try again.") },
                  ),
              },
            },
          );
          onLinked?.(result);
        },
      },
    );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => {
          link.reset();
          setOpen(true);
        }}
      >
        <Link2 className="h-3.5 w-3.5" aria-hidden />
        Same job as…
      </Button>
      <JobPicker
        source={{ job: savedJob.id }}
        open={open}
        onOpenChange={setOpen}
        title="Which job is this?"
        description="Pick the job this email is about. Its emails move there, the card moves forward if the email got further, and this copy is removed."
        onPick={pick}
        busy={link.isPending}
        error={link.isError ? errorText(link.error, "Couldn't link that. Try again.") : null}
      />
    </>
  );
}
