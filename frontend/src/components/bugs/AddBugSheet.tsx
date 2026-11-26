import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Bug, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BugForm, EMPTY_DRAFT } from "@/components/bugs/BugForm";
import { StatusPill } from "@/components/bugs/BugRow";
import { type PickedShot, ShotPicker } from "@/components/bugs/ShotPicker";
import { useAddBug, useMergeBug, useUploadShot } from "@/hooks/useBugReports";
import { useIsPhone } from "@/hooks/useIsPhone";
import { useJobCatcherInstalls } from "@/hooks/useJobCatcher";
import { APP_VERSION } from "@/lib/appVersion";
import {
  type BugContext,
  type BugDraft,
  type BugSimilar,
  browserName,
  sectionForPath,
  stepsCheck,
  stepsFrom,
  saveErrorText,
} from "@/lib/bugs";
import { cn } from "@/lib/utils";

/** What the app fills in for the owner, read when the form opens. */
function useAutoContext(
  open: boolean,
  page: string,
): BugContext & { page: string } {
  const phone = useIsPhone();
  const { data: installs } = useJobCatcherInstalls(open);
  const newest = [...(installs ?? [])].sort((a, b) =>
    b.last_seen_at.localeCompare(a.last_seen_at),
  )[0];
  return {
    page,
    device: phone ? "phone" : "computer",
    browser: browserName(navigator.userAgent),
    theme: document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
    app_version: APP_VERSION,
    ...(newest?.version ? { job_catcher: newest.version } : {}),
  };
}

/** After saving: pictures that didn't upload, and reports it looks like. */
interface Saved {
  id: string;
  similar: BugSimilar[];
  failed: PickedShot[];
}

/**
 * The step after Save, when there's something to say: a picture that
 * didn't upload (try again; the report itself is kept), and "Looks like…"
 * for an open report that seems to be the same problem: one tap merges
 * them, or it's new.
 */
function AfterSave({
  saved,
  onRetried,
  onDone,
}: {
  saved: Saved;
  onRetried: (failed: PickedShot[]) => void;
  onDone: () => void;
}) {
  const upload = useUploadShot();
  const merge = useMergeBug();
  const [retrying, setRetrying] = useState(false);
  const pictures = saved.failed.length;

  const retry = async () => {
    setRetrying(true);
    const still: PickedShot[] = [];
    for (const shot of saved.failed) {
      await upload
        .mutateAsync({ id: saved.id, file: shot.blob })
        .catch(() => still.push(shot));
    }
    setRetrying(false);
    onRetried(still);
  };

  return (
    <div className="grid gap-4">
      {pictures > 0 && (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
        >
          <p className="text-sm">
            Added, but {pictures === 1 ? "the picture" : "the pictures"} didn't
            upload.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void retry()}
            disabled={retrying}
          >
            {retrying && <Loader2 className="animate-spin" aria-hidden />}
            Try again
          </Button>
        </div>
      )}
      {saved.similar.length > 0 && (
        <section aria-labelledby="looks-like" className="space-y-2">
          <h3 id="looks-like" className="text-sm font-semibold">
            Looks like
          </h3>
          <ul className="space-y-2">
            {saved.similar.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="break-words text-sm font-medium leading-snug">
                    {s.title}
                  </p>
                  <StatusPill status={s.status} />
                </div>
                <Button
                  size="sm"
                  disabled={merge.isPending}
                  aria-label={`Same problem as ${s.title}`}
                  onClick={() =>
                    merge.mutate(
                      { id: saved.id, intoId: s.id },
                      {
                        onSuccess: () => {
                          toast.success("Added to the one you had");
                          onDone();
                        },
                      },
                    )
                  }
                >
                  Same problem
                </Button>
              </li>
            ))}
          </ul>
          {merge.isError && (
            <p role="alert" className="text-sm text-destructive">
              Couldn't merge them. Try again.
            </p>
          )}
        </section>
      )}
      <DialogFooter>
        <Button
          variant={saved.similar.length ? "outline" : "default"}
          className="w-full md:w-auto"
          onClick={onDone}
        >
          {saved.similar.length ? "It's new" : "Done"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * Add a bug or idea (spec 032), from any page, for the owner. The section is
 * guessed from the page; the page, device, browser, theme and versions are
 * filled in and shown. Up to 3 screenshots, shrunk before they're sent.
 * Saving keeps you where you are; if it fails, what you typed stays. After
 * saving, "Looks like…" offers a report that seems the same.
 */
export function AddBugSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { pathname, search } = useLocation();
  const [draft, setDraft] = useState<BugDraft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState(false);
  const [shots, setShots] = useState<PickedShot[]>([]);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [uploading, setUploading] = useState(false);
  const add = useAddBug();
  const upload = useUploadShot();
  const context = useAutoContext(open, pathname);
  // Until the owner picks one, the section follows the page they're on.
  const shown = touched
    ? draft
    : { ...draft, section: sectionForPath(pathname, search) };
  const busy = add.isPending || uploading;

  const close = (next: boolean) => {
    // The report is kept: what's left of it in the form can go.
    if (!next && saved) {
      for (const shot of saved.failed) URL.revokeObjectURL(shot.url);
      setSaved(null);
    }
    onOpenChange(next);
  };

  const finish = (id: string, similar: BugSimilar[], failed: PickedShot[]) => {
    for (const s of shots) if (!failed.includes(s)) URL.revokeObjectURL(s.url);
    setDraft(EMPTY_DRAFT);
    setTouched(false);
    setShots([]);
    if (!failed.length && !similar.length) {
      toast.success("Added");
      onOpenChange(false);
      return;
    }
    setSaved({ id, similar, failed });
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shown.title.trim() || stepsCheck(shown.steps).tooLong !== null) return;
    const { page, ...ctx } = context;
    add.mutate(
      {
        type: shown.type,
        title: shown.title.trim(),
        section: shown.section,
        ...(shown.type === "bug" ? { severity: shown.severity } : {}),
        actual: shown.actual,
        expected: shown.type === "bug" ? shown.expected : "",
        steps: stepsFrom(shown.steps),
        place: page,
        context: ctx,
      },
      {
        onSuccess: async ({ report, similar }) => {
          // The report is saved first; a picture that fails doesn't undo it.
          setUploading(true);
          const failed: PickedShot[] = [];
          for (const shot of shots) {
            await upload
              .mutateAsync({ id: report.id, file: shot.blob })
              .catch(() => failed.push(shot));
          }
          setUploading(false);
          finish(report.id, similar ?? [], failed);
        },
      },
    );
  };

  const filled = [
    context.page,
    context.device,
    context.browser,
    context.theme,
    `app ${APP_VERSION}`,
    context.job_catcher && `Job Catcher ${context.job_catcher}`,
    "now",
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{saved ? "Added" : "Add a bug or idea"}</DialogTitle>
          <DialogDescription className="sr-only">
            It goes straight to Bugs &amp; ideas.
          </DialogDescription>
        </DialogHeader>
        {saved ? (
          <AfterSave
            saved={saved}
            onRetried={(failed) => {
              const next = { ...saved, failed };
              if (!failed.length && !saved.similar.length) {
                toast.success("Added");
                close(false);
              } else setSaved(next);
            }}
            onDone={() => close(false)}
          />
        ) : (
          <form onSubmit={save} className="grid gap-4">
            <BugForm
              idPrefix="add-bug"
              draft={shown}
              onChange={(d) => {
                setDraft(d);
                setTouched(true);
              }}
            />
            <ShotPicker idPrefix="add-bug" shots={shots} onChange={setShots} />
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Filled in for you
              </p>
              <ul
                className="flex flex-wrap gap-1.5"
                aria-label="Filled in for you"
              >
                {filled.map((v) => (
                  <li
                    key={v as string}
                    className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                  >
                    {v}
                  </li>
                ))}
              </ul>
            </div>
            {add.isError && (
              <p role="alert" className="text-sm text-destructive">
                {saveErrorText(add.error)}
              </p>
            )}
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  !shown.title.trim() ||
                  stepsCheck(shown.steps).tooLong !== null ||
                  busy
                }
                className="w-full md:w-auto"
              >
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                Save
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The owner's Add button: a row in the desktop sidebar, an icon in the
 * phone's top bar. Its form keeps what was typed until it's saved. */
export function AddBugButton({ variant }: { variant: "sidebar" | "icon" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          aria-label="Add a bug or idea"
          onClick={() => setOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
        >
          <Bug className="h-5 w-5" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Bug className="h-4 w-4 shrink-0" aria-hidden />
          Add a bug or idea
        </button>
      )}
      <AddBugSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
