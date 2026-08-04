import { useState } from "react";
import { Link2, Loader2, Plus } from "lucide-react";
import { useAddManualJob } from "@/hooks/useSavedJobs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * "Add job manually" (FR-004a) — paste a link from LinkedIn/Indeed/anywhere
 * plus a few details, and it becomes a normal tracked job.
 */
export function AddJobDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [isRemote, setIsRemote] = useState(false);

  const addJob = useAddManualJob();

  function reset() {
    setUrl("");
    setTitle("");
    setCompany("");
    setLocation("");
    setIsRemote(false);
    addJob.reset();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    addJob.mutate(
      {
        url,
        title,
        company,
        location: location || undefined,
        is_remote: isRemote,
      },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
        },
        // Errors render via addJob.isError — observe to avoid floating rejection
        onError: () => {},
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" aria-hidden />
          Add job
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a job manually</DialogTitle>
          <DialogDescription>
            Found a job on LinkedIn, Indeed, or a company site? Paste the link
            and a few details — it&apos;ll be tracked like any other job.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          {addJob.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {addJob.error.message.includes("409")
                  ? "You already saved this job."
                  : "Could not add the job. Check the link and try again."}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="job-url">Job link</Label>
            <div className="relative">
              <Link2
                className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="job-url"
                type="url"
                required
                placeholder="https://www.linkedin.com/jobs/view/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="job-title">Job title</Label>
            <Input
              id="job-title"
              required
              maxLength={500}
              placeholder="Senior Python Developer"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="job-company">Company</Label>
              <Input
                id="job-company"
                required
                maxLength={255}
                placeholder="Acme Corp"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-location">Location (optional)</Label>
              <Input
                id="job-location"
                maxLength={255}
                placeholder="New York, NY"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="job-remote"
              checked={isRemote}
              onCheckedChange={setIsRemote}
            />
            <Label htmlFor="job-remote" className="cursor-pointer text-sm">
              Remote position
            </Label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={addJob.isPending}>
              {addJob.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              )}
              Save job
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
