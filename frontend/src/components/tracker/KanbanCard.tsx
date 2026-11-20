import { useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Check, Mail, MailCheck, MoreHorizontal, Search } from "lucide-react";
import { formatDistanceToNow, differenceInDays, format } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmailViewer } from "@/components/email/EmailViewer";
import { JobDetailDialog } from "@/components/tracker/JobDetailDialog";
import type { JobEmailLatest } from "@/hooks/useEmailAccount";
import { useToggleResearchFlag } from "@/hooks/useTracker";
import { highlightParts } from "@/lib/boardFilter";
import { emailLabel } from "@/lib/emailUpdates";
import { getNextAction, TONE_DOT } from "@/lib/nextAction";
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
  /** The email behind this job's stage, and what opening it does. */
  email?: JobEmailLatest;
  onOpenEmail?: () => void;
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
  email,
  onOpenEmail,
  className,
}: CardFaceProps) {
  const { job_listing, last_stage_change, applied_at, flagged_for_research, emailed_at } = savedJob;
  const daysSinceStageChange = differenceInDays(new Date(), new Date(last_stage_change));
  // The CRM "next step" for this card (what to do / who's ghosting you).
  const nextAction = getNextAction(savedJob, { followUpDays, stageName: stageName ?? null });
  const where = [
    job_listing.company,
    job_listing.is_remote ? "Remote" : job_listing.location,
  ].filter(Boolean);

  return (
    <div
      className={cn(
        "group rounded-xl border bg-card p-3.5 text-card-foreground shadow-xs",
        "transition-[transform,box-shadow,border-color] duration-150 motion-reduce:transition-none",
        "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:ring-2 hover:ring-primary/15",
        "motion-reduce:hover:translate-y-0",
        flagged_for_research && "border-amber-400/60",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="line-clamp-2 text-sm font-semibold leading-snug">
          <Marked text={job_listing.title} words={words} />
        </p>
        <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
      </div>

      <p className="mt-1 truncate text-xs text-muted-foreground">
        {where.map((part, i) => (
          <span key={i}>
            {i > 0 && " · "}
            {i === 0 ? <Marked text={part} words={words} /> : part}
          </span>
        ))}
      </p>

      {(applied_at || emailed_at) && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground/80">
          {applied_at && (
            <span>Applied {formatDistanceToNow(new Date(applied_at), { addSuffix: true })}</span>
          )}
          {emailed_at && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <MailCheck className="h-3 w-3 shrink-0" aria-hidden />
              Emailed {format(new Date(emailed_at), "MMM d")}
            </span>
          )}
        </p>
      )}

      {/* Why the card is where it is: the email that put it here. Opens the
          email without opening the job. */}
      {email && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenEmail?.();
          }}
          className="mt-1.5 flex w-full items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-left text-xs font-medium text-primary hover:bg-primary/15 pointer-coarse:py-2"
        >
          <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {emailLabel(email.event_type)} ·{" "}
            {format(new Date(email.email_date ?? email.created_at), "MMM d")}
          </span>
        </button>
      )}

      {/* The next move, quietly: a coloured dot and a few words. */}
      {nextAction && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[nextAction.tone])}
            aria-hidden
          />
          <span className="truncate">{nextAction.label}</span>
          {/* Nothing has happened for longer than the follow-up time in Settings. */}
          {daysSinceStageChange >= followUpDays && (
            <span className="ml-auto shrink-0 font-medium text-amber-600 dark:text-amber-400">
              quiet {daysSinceStageChange}d
            </span>
          )}
        </p>
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
  /** The email behind this job's stage, if it has one. */
  email?: JobEmailLatest;
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
  email,
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
  const [emailOpen, setEmailOpen] = useState(false);
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
          email={email}
          onOpenEmail={() => setEmailOpen(true)}
          className={cn(matched && "border-primary/60 ring-2 ring-primary/40")}
        />
      </div>

      {email && (
        <EmailViewer
          eventId={emailOpen ? email.event_id : null}
          mailLink={email.mail_link}
          searchLink={email.mail_search_link}
          onClose={() => setEmailOpen(false)}
        />
      )}

      {everOpened && <JobDetailDialog savedJob={savedJob} open={open} onOpenChange={setOpen} />}
    </>
  );
}
