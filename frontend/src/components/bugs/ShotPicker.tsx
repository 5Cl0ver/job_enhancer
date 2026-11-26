import { useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { shrinkImage } from "@/lib/shrinkImage";
import { cn } from "@/lib/utils";

export const SHOTS_MAX = 3;

/** A picked screenshot, already shrunk, with a preview URL. */
export interface PickedShot {
  key: string;
  blob: Blob;
  url: string;
}

let nextKey = 0;

/** A picked picture, shrunk for sending, or null when it can't be used. */
export async function pickShot(file: File): Promise<PickedShot | null> {
  const blob = await shrinkImage(file);
  if (!blob) return null;
  nextKey += 1;
  return { key: `shot-${nextKey}`, blob, url: URL.createObjectURL(blob) };
}

/**
 * "Add a screenshot" (spec 032): choose a picture, or on a phone take a photo
 * or pick one from the library (the phone offers both). Each is shrunk before
 * it's sent; up to 3, each with a preview and a remove button.
 */
export function ShotPicker({
  shots,
  onChange,
  idPrefix,
}: {
  shots: PickedShot[];
  onChange: (shots: PickedShot[]) => void;
  idPrefix: string;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setProblem(null);
    const room = SHOTS_MAX - shots.length;
    const picked: PickedShot[] = [];
    let bad = 0;
    for (const file of Array.from(files).slice(0, room)) {
      const shot = await pickShot(file).catch(() => null);
      if (shot) picked.push(shot);
      else bad += 1;
    }
    setBusy(false);
    if (bad) setProblem("That picture couldn't be used. Try a JPEG or PNG.");
    else if (files.length > room) setProblem(`Up to ${SHOTS_MAX} screenshots.`);
    if (picked.length) onChange([...shots, ...picked]);
  };

  const remove = (key: string) => {
    const gone = shots.find((s) => s.key === key);
    if (gone) URL.revokeObjectURL(gone.url);
    onChange(shots.filter((s) => s.key !== key));
  };

  return (
    <div className="grid gap-2">
      {shots.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Screenshots">
          {shots.map((s, i) => (
            <li key={s.key} className="relative">
              <img
                src={s.url}
                alt={`Screenshot ${i + 1}`}
                className="h-16 w-16 rounded-md border object-cover pointer-coarse:h-20 pointer-coarse:w-20"
              />
              <button
                type="button"
                onClick={() => remove(s.key)}
                aria-label={`Remove screenshot ${i + 1}`}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border bg-background shadow-sm pointer-coarse:h-7 pointer-coarse:w-7"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {shots.length < SHOTS_MAX && (
        <label
          htmlFor={`${idPrefix}-shot`}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "cursor-pointer justify-self-start has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
            busy && "pointer-events-none opacity-60",
          )}
        >
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <ImagePlus aria-hidden />
          )}
          {shots.length ? "Add another" : "Add a screenshot"}
          <input
            id={`${idPrefix}-shot`}
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
