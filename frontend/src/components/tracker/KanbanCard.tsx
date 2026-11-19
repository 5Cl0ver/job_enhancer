import { useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { AlertTriangle, Check, Clock, MailCheck, MoreHorizontal, Search } from "lucide-react";
import { formatDistanceToNow, differenceInDays, format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JobDetailDialog } from "@/components/tracker/JobDetailDialog";
import { useToggleResearchFlag } from "@/hooks/useTracker";
import { highlightParts } from "@/lib/boardFilter";
import { getNextAction, TONE_STYLES } from "@/lib/nextAction";
import { cn } from "@/lib/utils";
import type { PipelineStage, SavedJob } from "@/types/api";

/** Text with the searched words marked. */
function Marked({ text, words }: { text: string; words: string[] }) {
  return (
    <>
      {highlightParts(text, words).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded-sm bg-yellow-200 text-inherit dark:bg-yellow-500/40">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

interface CardFaceProps {
  savedJob: SavedJob;
  followUpDays: number;
  /** The name of the stage this card sits in — drives the "next action" pill. */
  stageName?: string | null;
  /** Search words to mark in the title and company. */
  words?: string[];
  /** Buttons shown at the top right (the Move menu). */
  actions?: React.ReactNode;
  className?: string;
}

/** What a card looks like. Shared by the card on the board and the copy that
 * follows the pointer while dragging. */
export function CardFace({
  savedJob,
  followUpDays,
  stageName,
  words = [],
  actions,
  className,
}: CardFaceProps) {
  const { job_listing, last_stage_change, applied_at, flagged_for_research, emailed_at } = savedJob;
  const daysSinceStageChange = differenceInDays(new Date(), new Date(last_stage_change));
  const isFollowUpOverdue = daysSinceStageChange >= followUpDays;
  // The CRM "next step" for this card (what to do / who's ghosting you).
  const nextAction = getNextAction(savedJob, { followUpDays, stageName: stageName ?? null });
  const where = [job_listing.company, job_listing.location].filter(Boolean);

  return (
    <div
      className={cn(
        "group rounded-lg border bg-card p-3 text-card-foreground shadow-sm",
        "transition-[transform,box-shadow,border-color] duration-150 motion-reduce:transition-none",
        "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:ring-2 hover:ring-primary/15",
        "motion-reduce:hover:translate-y-0",
        flagged_for_research && "border-amber-300 ring-1 ring-amber-200 dark:ring-amber-800",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="line-clamp-2 text-sm font-medium leading-tight">
          <Marked text={job_listing.title} words={words} />
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
          {isFollowUpOverdue && (
            <span
              aria-label="Follow-up overdue"
              title={`No activity for ${daysSinceStageChange} days`}
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            </span>
          )}
          {actions}
        </div>
      </div>

      <p className="mt-1 truncate text-xs text-muted-foreground">
        {where.map((part, i) => (
          <span key={i}>
            {i > 0 && " · "}
            {i === 0 ? <Marked text={part} words={words} /> : part}
          </span>
        ))}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {job_listing.is_remote && (
          <Badge variant="secondary" className="text-xs">
            Remote
          </Badge>
        )}
        {applied_at && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3 shrink-0" aria-hidden />
            Applied {formatDistanceToNow(new Date(applied_at), { addSuffix: true })}
          </span>
        )}
        {emailed_at && (
          <span className="flex items-center gap-1 text-emerald-600">
            <MailCheck className="h-3 w-3 shrink-0" aria-hidden />
            Emailed {format(new Date(emailed_at), "MMM d")}
          </span>
        )}
      </div>

      {/* CRM next-action pill — tells you the next move at a glance. */}
      {nextAction && (
        <div
          className={cn(
            "mt-1.5 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
            TONE_STYLES[nextAction.tone],
          )}
          title="Suggested next step"
        >
          {nextAction.label}
        </div>
      )}
    </div>
  );
}

interface KanbanCardProps {
  savedJob: SavedJob;
  followUpDays: number;
  stageName?: string | null;
  /** Every stage column, for the "Move to" menu. */
  stages: PipelineStage[];
  /** The stage the job is in, or null when it has none yet. */
  stageId: string | null;
  onMove: (stageId: string) => void;
  words?: string[];
  /** A search is on and this card doesn't match it. */
  dimmed?: boolean;
  /** Flash once (the search jumped to this card). */
  pulse?: boolean;
}

export function KanbanCard({
  savedJob,
  followUpDays,
  stageName,
  stages,
  stageId,
  onMove,
  words = [],
  dimmed,
  pulse,
}: KanbanCardProps) {
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: savedJob.id });
  const [open, setOpen] = useState(false);
  // The dialog is mounted the first time it's opened and then kept, so closing
  // still animates, without a hidden dialog per card on a board of hundreds.
  const [everOpened, setEverOpened] = useState(false);
  const openDetails = () => {
    setEverOpened(true);
    setOpen(true);
  };
  const toggleFlag = useToggleResearchFlag();
  // Distinguish a click from a drag: only open the detail if the pointer barely
  // moved (a drag moves ≥5px and is handled by dnd-kit instead).
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const { job_listing, flagged_for_research } = savedJob;
  const matched = words.length > 0 && !dimmed;

  // The menu is a second way to do everything dragging does, for phones and
  // keyboards. Its events must not reach the card (start a drag, open details).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const menu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Move or flag ${job_listing.title}`}
          onMouseDown={stop}
          onTouchStart={stop}
          onPointerDown={stop}
          onClick={stop}
          onKeyDown={stop}
          className={cn(
            "rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:p-2.5",
            "focus-visible:opacity-100 data-[state=open]:opacity-100",
            "md:opacity-0 md:group-hover:opacity-100",
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52"
        onClick={stop}
        onKeyDown={stop}
        onMouseDown={stop}
        onTouchStart={stop}
        onPointerDown={stop}
      >
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        {stages.map((s) => (
          <DropdownMenuItem
            key={s.id}
            disabled={s.id === stageId}
            onSelect={() => onMove(s.id)}
          >
            <span className="truncate">{s.name}</span>
            {s.id === stageId && <Check className="ml-auto h-3.5 w-3.5" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            toggleFlag.mutate({ savedJobId: savedJob.id, flagged: !flagged_for_research })
          }
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          {flagged_for_research ? "Remove from Contact Further" : "Add to Contact Further"}
        </DropdownMenuItem>
        {/* After the menu has closed, so the two don't fight over focus. */}
        <DropdownMenuItem onSelect={() => window.setTimeout(openDetails, 0)}>
          Open details
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <div
        ref={setNodeRef}
        id={`card-${savedJob.id}`}
        role="button"
        tabIndex={0}
        aria-label={`${job_listing.title} at ${job_listing.company}. Open details`}
        {...listeners}
        onPointerDownCapture={(e) => {
          downPos.current = { x: e.clientX, y: e.clientY };
        }}
        onClick={(e) => {
          const d = downPos.current;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return; // was a drag
          openDetails();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openDetails();
          }
        }}
        className={cn(
          // touch-manipulation: a swipe still scrolls the column; press and hold drags.
          "cursor-pointer touch-manipulation rounded-lg outline-none active:cursor-grabbing",
          "focus-visible:ring-2 focus-visible:ring-ring",
          "transition-opacity duration-150 motion-reduce:transition-none",
          isDragging && "opacity-40",
          dimmed && "opacity-40",
          pulse && "animate-[card-pulse_0.9s_ease-out_2] motion-reduce:animate-none",
        )}
      >
        <CardFace
          savedJob={savedJob}
          followUpDays={followUpDays}
          stageName={stageName}
          words={matched ? words : []}
          actions={menu}
          className={cn(matched && "border-primary/60 ring-2 ring-primary/40")}
        />
      </div>

      {everOpened && <JobDetailDialog savedJob={savedJob} open={open} onOpenChange={setOpen} />}
    </>
  );
}
