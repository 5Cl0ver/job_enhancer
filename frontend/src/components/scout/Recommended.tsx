/**
 * "Use recommended settings": the settings that find the most jobs at the
 * user's level (10 jobs a run, the past week, fit 6+, 25 miles, Entry + Mid,
 * the degree rule off, skills from the resume). The app serves them; this
 * shows exactly what would change and changes nothing until the user presses
 * Apply. The button only shows while something would change.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
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
import { resumeSkills, useRecommended } from "@/hooks/useScout";
import { api } from "@/lib/api";
import {
  type Mission,
  missionChanges,
  type Recommended,
  type SettingChange,
  type Track,
  trackChanges,
} from "@/lib/scout";

/** Skills can be filled from the resume: the type has none and a resume. */
function fillSkills(track: Track | undefined): boolean {
  return !!track && track.key_skills.length === 0 && !!track.resume_id;
}

export function allChanges(
  rec: Recommended,
  mission: Mission | undefined,
  track: Track | undefined,
): SettingChange[] {
  return [
    ...(mission ? missionChanges(mission, rec) : []),
    ...(track ? trackChanges(track, rec) : []),
    ...(fillSkills(track)
      ? [{ label: "Skills", from: "None", to: "From your resume" }]
      : []),
  ];
}

function useApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rec,
      mission,
      track,
    }: {
      rec: Recommended;
      mission?: Mission;
      track?: Track;
    }) => {
      if (mission && missionChanges(mission, rec).length) {
        const r = rec.mission;
        await api.patch(`/v1/scout/missions/${mission.id}`, {
          job_count: Math.max(mission.job_count, r.job_count),
          posted_within_days: Math.max(
            mission.posted_within_days,
            r.posted_within_days,
          ),
          min_fit: Math.min(mission.min_fit, r.min_fit),
          ...(mission.location &&
          mission.remote !== "remote_only" &&
          mission.radius_miles == null
            ? { radius_miles: r.radius_miles }
            : {}),
        });
      }
      if (track && (trackChanges(track, rec).length || fillSkills(track))) {
        const levels = [
          ...new Set([...(track.levels ?? []), ...rec.track.levels]),
        ];
        const skills = fillSkills(track)
          ? await resumeSkills(track.resume_id!).catch(() => [])
          : [];
        await api.patch(`/v1/scout/tracks/${track.id}`, {
          levels,
          skip_rules: { ...track.skip_rules, degree_only: false },
          ...(skills.length ? { key_skills: skills } : {}),
        });
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["scout-missions"] });
      qc.invalidateQueries({ queryKey: ["scout-tracks"] });
    },
  });
}

export function RecommendedButton({
  mission,
  track,
}: {
  mission?: Mission;
  track?: Track;
}) {
  const { data: rec } = useRecommended();
  const apply = useApply();
  const [open, setOpen] = useState(false);
  if (!rec?.mission) return null;
  const changes = allChanges(rec, mission, track);
  if (!changes.length) return null;

  return (
    <>
      <Button
        variant="link"
        size="sm"
        className="h-auto gap-1 self-start p-0 text-xs pointer-coarse:min-h-11"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Use recommended settings
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Use recommended settings?</DialogTitle>
            <DialogDescription>
              These find the most jobs at your level. Here's what changes
              {mission && track ? ` for this search and ${track.name}` : ""}:
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-md border text-sm">
            {changes.map((c) => (
              <li
                key={c.label}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 p-2.5"
              >
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground">
                  {c.from} → <span className="text-foreground">{c.to}</span>
                </span>
              </li>
            ))}
          </ul>
          {mission?.location && !mission.location.includes(",") && (
            <p className="text-sm text-muted-foreground">
              Also: write the place as City, ST (for example “Springfield, IL”)
              in the search's settings, so the job boards find the right
              {` “${mission.location}”`}.
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Not now
            </Button>
            <Button
              disabled={apply.isPending}
              className="gap-1.5"
              onClick={() =>
                apply.mutate(
                  { rec, mission, track },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      toast.success("Recommended settings applied.");
                    },
                    onError: (e) =>
                      toast.error(
                        errorText(e, "Couldn't change the settings."),
                      ),
                  },
                )
              }
            >
              {apply.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              )}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
