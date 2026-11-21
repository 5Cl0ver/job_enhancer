import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { errorText } from "@/components/scout/errorText";
import { useResumes } from "@/hooks/useAI";
import {
  resumeSkills,
  useStartFresh,
  useTrackPasses,
  useUpdateTrack,
} from "@/hooks/useScout";
import type { Track } from "@/lib/scout";
import { Button } from "@/components/ui/button";

/** A resume type with no skills: fill them from the main resume in one tap. */
export function FillSkills({ track }: { track: Track }) {
  const { data: resumes = [] } = useResumes();
  const update = useUpdateTrack();
  const [busy, setBusy] = useState(false);
  const main = resumes.find((r) => r.is_active);
  if (!main) return null;
  const fill = async () => {
    setBusy(true);
    try {
      const found = await resumeSkills(main.id);
      if (found.length === 0) {
        toast.info("No skills found in your resume. Add some with Edit.");
        return;
      }
      await update.mutateAsync({ id: track.id, key_skills: found.slice(0, 40) });
      toast.success(`Filled in ${Math.min(found.length, 40)} skills from your resume.`);
    } catch (err) {
      toast.error(errorText(err, "Couldn't fill the skills."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5 self-start pointer-coarse:min-h-11"
      disabled={busy}
      onClick={fill}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
      )}
      Fill skills from my resume
    </Button>
  );
}

/**
 * The titles Claude passed over for this resume type, and a fresh start: they
 * are weighed again, and jobs it scored below the bar may be looked at again.
 */
export function PassedTitles({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const { data } = useTrackPasses(track.id);
  const fresh = useStartFresh();
  if (!data) return null;
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground">
          {data.count === 0
            ? "No titles passed over"
            : `${data.count} title${data.count === 1 ? "" : "s"} Claude passed over`}
        </span>
        {data.count > 0 && (
          <button
            type="button"
            className="font-medium text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide" : "View"}
          </button>
        )}
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50 pointer-coarse:min-h-11"
          disabled={fresh.isPending}
          onClick={() =>
            fresh.mutate(track.id, {
              onSuccess: () =>
                toast.success(
                  `${track.name}: titles and low-scored jobs will be looked at again.`,
                ),
            })
          }
        >
          Start fresh
        </button>
      </div>
      {open && data.titles.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Titles Claude passed over">
          {data.titles.map((t) => (
            <li
              key={t.title}
              className="rounded border bg-muted/40 px-1.5 py-0.5 [overflow-wrap:anywhere]"
            >
              {t.title}
              {t.times > 1 && <span className="text-muted-foreground"> ×{t.times}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
