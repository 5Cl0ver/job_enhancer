import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ImageOff, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePhoto } from "@/hooks/useApply";
import { type ApplyPage, latestPages, pageAnswers } from "@/lib/apply";

const RESUME_LINE: Record<NonNullable<ApplyPage["resume"]>, string | null> = {
  attached: "Résumé attached",
  failed: "Résumé not attached",
  no_file: "No résumé file",
  no_box: null,
};

export function Photo({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const { data: src, isError } = usePhoto(id);
  if (isError) return <div className={cn("flex items-center justify-center bg-muted", className)}><ImageOff className="h-4 w-4" aria-label="Couldn't load" /></div>;
  if (!src) return <Skeleton className={className} />;
  return <img src={src} alt={alt} className={cn("object-cover object-top", className)} />;
}

/** Every photo of every page, one at a time, full width (swipe-sized arrows). */
function Viewer({
  photos,
  at,
  onClose,
}: {
  photos: { id: string; label: string }[];
  at: number | null;
  onClose: () => void;
}) {
  const [i, setI] = useState(at ?? 0);
  const shown = at === null ? null : photos[Math.min(i, photos.length - 1)];
  return (
    <Dialog open={at !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[95dvh] max-w-4xl overflow-y-auto p-3 sm:p-4">
        <DialogTitle className="text-sm">{shown?.label}</DialogTitle>
        <DialogDescription className="sr-only">A photo Job Catcher took of the application page.</DialogDescription>
        {shown && <Photo id={shown.id} alt={shown.label} className="w-full rounded border" />}
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" disabled={i <= 0} onClick={() => setI((n) => n - 1)} aria-label="Previous photo">
            <ChevronLeft className="h-4 w-4" aria-hidden /> Back
          </Button>
          <span className="text-xs text-muted-foreground">
            {Math.min(i, photos.length - 1) + 1} of {photos.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={i >= photos.length - 1}
            onClick={() => setI((n) => n + 1)}
            aria-label="Next photo"
          >
            Next <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PageRow({
  page,
  onPhoto,
  startOpen,
  photosOnly,
}: {
  page: ApplyPage;
  onPhoto: (photoId: string) => void;
  startOpen: boolean;
  photosOnly: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const answers = pageAnswers(page);
  const empty = answers.filter((a) => !a.a.trim()).length;
  const wrote = answers.filter((a) => a.claude).length;
  return (
    <li className="rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            Page {page.n}: {page.title}
          </span>
          <span className="block text-xs text-muted-foreground">
            {page.photo === "waiting" ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Taking photos…
              </span>
            ) : page.photo === "taken" ? (
              `${page.photo_ids.length} photo${page.photo_ids.length === 1 ? "" : "s"}`
            ) : (
              `No photo: ${page.reason ?? "Job Catcher didn't answer"}`
            )}
            {!photosOnly && ` · ${answers.length} answer${answers.length === 1 ? "" : "s"}`}
            {!photosOnly && wrote > 0 && ` · ${wrote} Claude wrote`}
            {!photosOnly && empty > 0 && ` · ${empty} left empty`}
            {page.resume && RESUME_LINE[page.resume] && ` · ${RESUME_LINE[page.resume]}`}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="space-y-3 border-t p-3">
          {page.photo_ids.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {page.photo_ids.map((id, i) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onPhoto(id)}
                  className="shrink-0 rounded border focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Open photo ${i + 1} of page ${page.n}`}
                >
                  <Photo id={id} alt="" className="h-40 w-28 rounded sm:h-48 sm:w-36" />
                </button>
              ))}
            </div>
          )}
          {answers.length > 0 && !photosOnly && (
            <dl className="space-y-2 text-sm">
              {answers.map((a, i) => (
                <div key={i} className="grid gap-0.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3">
                  <dt className="text-muted-foreground">{a.q}</dt>
                  <dd className={cn("whitespace-pre-wrap break-words", !a.a.trim() && "text-amber-600 dark:text-amber-400")}>
                    {a.a.trim() || "Left empty"}
                    {a.claude && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 text-xs text-primary">
                        <Sparkles className="h-3 w-3" aria-hidden /> Claude wrote this
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <a href={page.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-muted-foreground underline">
            {page.url}
          </a>
        </div>
      )}
    </li>
  );
}

/**
 * Every page Claude filled: photos (tap for full size) and, unless
 * `photosOnly` (the answers are in Your application, spec 033), each question
 * with its answer. A fix's redone page replaces the old one.
 */
export function Pages({
  pages,
  openAll = false,
  photosOnly = false,
}: {
  pages: ApplyPage[];
  openAll?: boolean;
  photosOnly?: boolean;
}) {
  const shown = latestPages(pages);
  const photos = shown.flatMap((p) =>
    p.photo_ids.map((id, i) => ({ id, label: `Page ${p.n}: ${p.title} (${i + 1}/${p.photo_ids.length})` })),
  );
  const [at, setAt] = useState<number | null>(null);
  if (!shown.length) return <p className="text-sm text-muted-foreground">No pages yet.</p>;
  return (
    <>
      <ol className="space-y-2">
        {shown.map((p) => (
          <PageRow
            key={`${p.n}-${p.url}`}
            page={p}
            startOpen={openAll}
            photosOnly={photosOnly}
            onPhoto={(id) => setAt(photos.findIndex((x) => x.id === id))}
          />
        ))}
      </ol>
      {at !== null && <Viewer key={at} photos={photos} at={at} onClose={() => setAt(null)} />}
    </>
  );
}
