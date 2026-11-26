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
import { useAddBug } from "@/hooks/useBugReports";
import { useIsPhone } from "@/hooks/useIsPhone";
import { useJobCatcherInstalls } from "@/hooks/useJobCatcher";
import {
  type BugContext,
  type BugDraft,
  browserName,
  sectionForPath,
  stepsFrom,
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
    ...(newest?.version ? { job_catcher: newest.version } : {}),
  };
}

/**
 * Add a bug or idea (spec 032), from any page, for the owner. The section is
 * guessed from the page; the page, device, browser, theme and Job Catcher's
 * version are filled in and shown. Saving keeps you where you are; if it
 * fails, what you typed stays.
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
  const add = useAddBug();
  const context = useAutoContext(open, pathname);
  // Until the owner picks one, the section follows the page they're on.
  const shown = touched
    ? draft
    : { ...draft, section: sectionForPath(pathname, search) };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shown.title.trim()) return;
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
        onSuccess: () => {
          toast.success("Added");
          setDraft(EMPTY_DRAFT);
          setTouched(false);
          onOpenChange(false);
        },
      },
    );
  };

  const filled = [
    context.page,
    context.device,
    context.browser,
    context.theme,
    context.job_catcher && `Job Catcher ${context.job_catcher}`,
    "now",
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a bug or idea</DialogTitle>
          <DialogDescription className="sr-only">
            It goes straight to Bugs &amp; ideas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <BugForm
            idPrefix="add-bug"
            draft={shown}
            onChange={(d) => {
              setDraft(d);
              setTouched(true);
            }}
          />
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
              Couldn't save, try again.
            </p>
          )}
          <DialogFooter>
            <Button
              type="submit"
              disabled={!shown.title.trim() || add.isPending}
              className="w-full md:w-auto"
            >
              {add.isPending && (
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
