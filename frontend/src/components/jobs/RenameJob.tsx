/**
 * Fix a saved job's name: title, company, place and link. Only this user's job
 * changes. When the app read the name from an email and it looks wrong, a
 * short amber note says so and opens the same form.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2, Pencil } from "lucide-react";
import { errorText } from "@/components/scout/errorText";
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
import { Label } from "@/components/ui/label";
import { useRenameJob } from "@/hooks/useSavedJobs";
import type { SavedJob } from "@/types/api";

function RenameForm({
  savedJob,
  onDone,
  followPage,
}: {
  savedJob: SavedJob;
  onDone: () => void;
  followPage: boolean;
}) {
  const j = savedJob.job_listing;
  const rename = useRenameJob();
  const navigate = useNavigate();
  const fromEmail = savedJob.origin === "email";
  const [title, setTitle] = useState(j.title);
  const [company, setCompany] = useState(j.company);
  const [location, setLocation] = useState(j.location === "Not specified" ? "" : j.location);
  // An email-made job's link is the email itself: leave it be unless a real
  // posting link is pasted in.
  const [link, setLink] = useState(fromEmail ? "" : j.apply_url);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = link.trim();
    if (!title.trim() || !company.trim()) return setProblem("Add a title and a company.");
    if (url && !/^https?:\/\//i.test(url))
      return setProblem("The link should start with http:// or https://");
    setProblem(null);
    rename
      .mutateAsync({
        id: savedJob.id,
        title: title.trim(),
        company: company.trim(),
        location: location.trim() || "Not specified",
        ...(url && url !== j.apply_url ? { apply_url: url } : {}),
      })
      .then((sj) => {
        onDone();
        // Copied to a listing of its own: its page moved too.
        if (followPage && sj.job_listing_id !== savedJob.job_listing_id)
          navigate(`/jobs/${sj.job_listing_id}`, { replace: true });
      })
      // Shown in the form (rename.error), which stays open to try again.
      .catch(() => {});
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Fix this job&apos;s name</DialogTitle>
        <DialogDescription>
          {fromEmail
            ? "The app read these from an email. Change anything that's wrong."
            : "Only your copy of this job changes."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="rename-title">Job title</Label>
          <Input
            id="rename-title"
            value={title}
            maxLength={500}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Platform Engineer"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rename-company">Company</Label>
          <Input
            id="rename-company"
            value={company}
            maxLength={255}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="e.g. Vellacor"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rename-place">Place</Label>
            <Input
              id="rename-place"
              value={location}
              maxLength={255}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City, or Remote"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rename-link">{fromEmail ? "Posting link (optional)" : "Link"}</Label>
            <Input
              id="rename-link"
              // Not type="url": the browser's own check would block the form
              // without saying why in words that match the rest of it.
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://"
            />
          </div>
        </div>
      </div>
      {(problem || rename.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {problem ?? errorText(rename.error, "Couldn't save that. Try again.")}
        </p>
      )}
      <DialogFooter className="gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={rename.isPending}>
          {rename.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The form in its own dialog (a bottom sheet on a phone). */
export function RenameJob({
  savedJob,
  open,
  onOpenChange,
  followPage = false,
}: {
  savedJob: SavedJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** On the job's own page: go to its new page if the job was copied. */
  followPage?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <RenameForm
            savedJob={savedJob}
            onDone={() => onOpenChange(false)}
            followPage={followPage}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A small pencil button that opens the form. */
export function RenameButton({
  savedJob,
  followPage = false,
}: {
  savedJob: SavedJob;
  followPage?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        Rename
      </Button>
      <RenameJob
        savedJob={savedJob}
        open={open}
        onOpenChange={setOpen}
        followPage={followPage}
      />
    </>
  );
}

/** "Check this job's name": shown where a job's name may be wrong. */
export function NameCheck({
  savedJob,
  followPage = false,
}: {
  savedJob: SavedJob;
  followPage?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!savedJob.name_doubtful) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="min-w-0 flex-1">
        This name was read from an email and may be wrong.
      </p>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Fix the name
      </Button>
      <RenameJob
        savedJob={savedJob}
        open={open}
        onOpenChange={setOpen}
        followPage={followPage}
      />
    </div>
  );
}

/** The same, as one quiet line on a card or row. */
export function NameCheckLine({ savedJob }: { savedJob: Pick<SavedJob, "name_doubtful"> }) {
  if (!savedJob.name_doubtful) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
      Check this job&apos;s name
    </p>
  );
}
