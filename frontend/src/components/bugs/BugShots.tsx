import { useState } from "react";
import { ImageOff, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteShot, useShotUrl } from "@/hooks/useBugReports";

function Thumb({
  id,
  n,
  onOpen,
}: {
  id: string;
  n: number;
  onOpen: (url: string) => void;
}) {
  const { url, isError } = useShotUrl(id);
  const box =
    "flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border bg-muted pointer-coarse:h-24 pointer-coarse:w-24";
  if (isError)
    return (
      <span className={box} title="Couldn't load it">
        <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden />
        <span className="sr-only">Screenshot {n} couldn't load</span>
      </span>
    );
  if (!url)
    return (
      <span className={box}>
        <Loader2
          className="h-4 w-4 animate-spin text-muted-foreground"
          aria-label="Loading"
        />
      </span>
    );
  return (
    <button
      type="button"
      className={box}
      onClick={() => onOpen(url)}
      aria-label={`View screenshot ${n}`}
    >
      <img src={url} alt="" className="h-full w-full object-cover" />
    </button>
  );
}

/**
 * A report's screenshots (spec 032): thumbnails, tap one to see it whole,
 * and a delete for each. Only the owner ever gets them from the server.
 */
export function BugShots({ shots }: { shots: { id: string; size: number }[] }) {
  const remove = useDeleteShot();
  const [viewing, setViewing] = useState<{ url: string; n: number } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<{ id: string; n: number } | null>(
    null,
  );
  if (!shots.length) return null;
  return (
    <section aria-labelledby="bug-shots" className="space-y-2">
      <h3
        id="bug-shots"
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {shots.length === 1 ? "Screenshot" : "Screenshots"}
      </h3>
      <ul className="flex flex-wrap gap-3">
        {shots.map((s, i) => (
          <li key={s.id} className="relative">
            <Thumb
              id={s.id}
              n={i + 1}
              onOpen={(url) => setViewing({ url, n: i + 1 })}
            />
            <button
              type="button"
              onClick={() => setDeleting({ id: s.id, n: i + 1 })}
              aria-label={`Delete screenshot ${i + 1}`}
              className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-destructive pointer-coarse:h-8 pointer-coarse:w-8"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="md:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Screenshot {viewing?.n}</DialogTitle>
            <DialogDescription className="sr-only">
              The whole picture.
            </DialogDescription>
          </DialogHeader>
          {viewing && (
            <img
              src={viewing.url}
              alt={`Screenshot ${viewing.n}`}
              className="max-h-[75dvh] w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="md:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this screenshot?</DialogTitle>
            <DialogDescription>This can't be undone.</DialogDescription>
          </DialogHeader>
          {remove.isError && (
            <p role="alert" className="text-sm text-destructive">
              Couldn't delete it. Try again.
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                deleting &&
                remove.mutate(deleting.id, {
                  onSuccess: () => setDeleting(null),
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
