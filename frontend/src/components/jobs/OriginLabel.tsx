/**
 * Where a saved job came from, as one small label: an icon and a few words
 * ("Claude Scout · fit 8/10", "From an email"). Nothing when it isn't known.
 */
import { Mail, MessageSquare, Pencil, Puzzle, Search, Sparkles } from "lucide-react";
import { originOf, originText, type Origin } from "@/lib/origin";
import { cn } from "@/lib/utils";
import type { SavedJob } from "@/types/api";

const ICON: Record<Origin, typeof Mail> = {
  scout: Sparkles,
  email: Mail,
  extension: Puzzle,
  claude: MessageSquare,
  search: Search,
  manual: Pencil,
};

export function OriginLabel({
  savedJob,
  className,
}: {
  savedJob: Pick<SavedJob, "origin" | "scout">;
  className?: string;
}) {
  const origin = originOf(savedJob);
  if (!origin) return null;
  const Icon = ICON[origin];
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground", className)}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{originText(savedJob)}</span>
    </span>
  );
}
