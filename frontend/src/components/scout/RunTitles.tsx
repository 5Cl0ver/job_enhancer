import { useState } from "react";
import { Ban, Pin, Plus } from "lucide-react";

import {
  useMissions,
  useTracks,
  useUpdateOverrides,
  useUpdateTrack,
} from "@/hooks/useScout";
import { type Run, withTitle } from "@/lib/scout";
import { errorText } from "@/components/scout/errorText";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * What an "Anything I'd be good at" run searched for, with how many good fits
 * each title found. Each title can be pinned (always searched), blocked (never
 * searched) or added to one of the user's resume types.
 */
export function RunTitles({ run }: { run: Run }) {
  const titles = run.titles ?? [];
  const { data: missions } = useMissions();
  const mission = missions?.find((m) => m.id === run.mission_id) ?? null;
  const overrides = useUpdateOverrides();
  const [note, setNote] = useState<string | null>(null);
  if (!run.broad || titles.length === 0) return null;

  const set = async (title: string, list: "always" | "never") => {
    if (!mission) return;
    setNote(null);
    try {
      await overrides.mutateAsync({
        id: mission.id,
        overrides: withTitle(mission.overrides, list, title),
      });
      setNote(
        list === "always"
          ? `“${title}” is searched on every run.`
          : `“${title}” won't be searched again.`,
      );
    } catch {
      // shown below
    }
  };
  const has = (list: "always" | "never", title: string) =>
    !!mission?.overrides?.[list].some(
      (t) => t.toLowerCase() === title.toLowerCase(),
    );

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Claude searched for:</p>
      <ul className="divide-y rounded-lg border">
        {titles.map((t) => (
          <li
            key={t.title}
            className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm [overflow-wrap:anywhere]">{t.title}</p>
              <p className="text-xs text-muted-foreground">
                {t.good_fits} good fit{t.good_fits === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {mission && (
                <>
                  <Button
                    size="sm"
                    variant={has("always", t.title) ? "secondary" : "outline"}
                    className="h-8 gap-1 pointer-coarse:h-11"
                    disabled={overrides.isPending || has("always", t.title)}
                    onClick={() => set(t.title, "always")}
                    aria-label={`Always search ${t.title}`}
                  >
                    <Pin className="h-3.5 w-3.5" aria-hidden />
                    Always
                  </Button>
                  <Button
                    size="sm"
                    variant={has("never", t.title) ? "secondary" : "outline"}
                    className="h-8 gap-1 pointer-coarse:h-11"
                    disabled={overrides.isPending || has("never", t.title)}
                    onClick={() => set(t.title, "never")}
                    aria-label={`Never search ${t.title}`}
                  >
                    <Ban className="h-3.5 w-3.5" aria-hidden />
                    Never
                  </Button>
                </>
              )}
              <AddToType title={t.title} onDone={setNote} />
            </div>
          </li>
        ))}
      </ul>
      {overrides.isError && (
        <p className="text-xs text-destructive">
          {errorText(overrides.error, "Couldn't change that. Try again.")}
        </p>
      )}
      {note && (
        <p className="text-xs text-muted-foreground" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

/** Add a title to one of the user's resume types. */
function AddToType({
  title,
  onDone,
}: {
  title: string;
  onDone: (note: string) => void;
}) {
  const { data: tracks = [] } = useTracks();
  const update = useUpdateTrack();
  const [value, setValue] = useState("");
  if (tracks.length === 0) return null;
  const add = async (trackId: string) => {
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    setValue(trackId);
    const known = track.target_titles.some(
      (t) => t.toLowerCase() === title.toLowerCase(),
    );
    try {
      if (!known)
        await update.mutateAsync({
          id: track.id,
          target_titles: [...track.target_titles, title],
        });
      onDone(
        known
          ? `${track.name} already has “${title}”.`
          : `Added “${title}” to ${track.name}.`,
      );
    } catch (err) {
      onDone(errorText(err, "Couldn't add it. Try again."));
    } finally {
      setValue("");
    }
  };
  return (
    <Select value={value} onValueChange={add}>
      <SelectTrigger
        className="h-8 w-auto gap-1 text-xs pointer-coarse:h-11"
        aria-label={`Add ${title} to a resume type`}
        disabled={update.isPending}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        <SelectValue placeholder="Add to resume type" />
      </SelectTrigger>
      <SelectContent>
        {tracks.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
