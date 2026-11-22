/**
 * Email Updates — what your inbox says about your applications, in plain words.
 *
 * When the app is sure which job an email is about (its link, job ID, a hiring site's
 * own template), the card has already moved: "Moved for you" sums those up by
 * stage and lists the newest as slim rows that open for the email, the job,
 * and Undo (Settings can turn this off). Other important updates (interview,
 * assessment, offer, rejection) follow as slim rows with "Move to <stage>" /
 * "Not this". A question appears only when an important email could be about
 * more than one of your saved jobs. Important updates for jobs you didn't save
 * get their own section ("Add to My Jobs" / "Not this"). Confirmations and
 * recruiter messages sit in small collapsed sections; unclear emails are
 * hidden. Long lists show the newest few until you ask for the rest, and
 * technical details stay under "Details". Every row says what the email says
 * and where its card is now ("Card: Interested → Rejected"), with the email and
 * the job one tap away. The inbox itself (scan, last checked, auto-move) sits
 * at the top. Nothing else changes on a card until you click.
 */
import { Children, useState } from "react";
import { Link } from "react-router-dom";
import {
  Briefcase,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  Gift,
  Link2,
  Loader2,
  MailCheck,
  Undo2,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  useAnswerQuestion,
  useDetectedEvents,
  useGroupAction,
  useReviewEvent,
  useTrackEvent,
  type DetectedEvent,
} from "@/hooks/useEmailAccount";
import {
  collapseRepeats,
  emailWhen,
  group,
  question,
  reason,
  sentence,
  type UpdateGroup,
} from "@/lib/emailUpdates";
import { Button } from "@/components/ui/button";
import { JobPicker } from "@/components/jobs/SameJob";
import { useLinkEvent, useUnlinkEvent } from "@/hooks/useJobLinks";
import { EmailViewer } from "@/components/email/EmailViewer";
import { InboxBar } from "@/components/settings/EmailConnectCard";
import { ErrorState } from "@/components/common/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  interview: { icon: CalendarCheck, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  assessment: { icon: ClipboardList, tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  offer: { icon: Gift, tone: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  rejected: { icon: XCircle, tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  applied: { icon: MailCheck, tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
};
const FALLBACK = { icon: Briefcase, tone: "bg-muted text-muted-foreground" };

/** What the email says, in a few words, for the line under each row. */
const SAYS: Record<string, string> = {
  rejected: "Says you weren't selected",
  applied: "Confirms they got your application",
  interview: "Invites you to interview",
  assessment: "Sends you an assessment",
  offer: "Makes you an offer",
  recruiter: "A recruiter reaching out",
};

/** How many rows a long section shows before "Show all". */
const SHOWN = 3;

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export default function EmailUpdatesPage() {
  const { data: events, isLoading, isError, refetch } = useDetectedEvents();
  const g = group(events ?? []);
  const important = collapseRepeats(g.important);
  const confirmations = collapseRepeats(g.confirmations);
  const unsaved = collapseRepeats(g.unsaved);
  const nothing =
    !isLoading &&
    g.moved.length +
      g.questions.length +
      g.important.length +
      g.unsaved.length +
      g.confirmations.length ===
      0;

  return (
    <div className="container mx-auto max-w-3xl md:px-4 md:py-6">
      <header className="mb-6 space-y-1 max-md:hidden">
        <h1 className="text-2xl font-bold tracking-tight">Email updates</h1>
        <p className="text-sm text-muted-foreground">
          What your inbox says about your applications.
        </p>
      </header>

      <InboxBar />

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}
      {isError && !events && (
        <ErrorState title="Couldn't load your email updates" onRetry={() => refetch()}>
          The server didn&apos;t answer. Nothing was lost.
        </ErrorState>
      )}

      {nothing && !isError && (
        <div className="flex flex-col items-center gap-2 rounded-lg border py-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" aria-hidden />
          <p className="font-medium">You're all caught up</p>
          <p className="text-sm text-muted-foreground">
            New updates from your inbox will show up here.{" "}
            <Link to="/settings#email" className="text-primary underline">
              Email settings
            </Link>
          </p>
        </div>
      )}

      {g.questions.length > 0 && (
        <Section title="Needs your answer" count={g.questions.length}>
          {g.questions.map((ev) => (
            <QuestionRow key={ev.id} ev={ev} />
          ))}
        </Section>
      )}

      {important.length > 0 && (
        <Section
          title="Waiting for your click"
          count={important.length}
          hint="These emails didn't name the job exactly, so the card stays put until you say so."
        >
          {important.map((u) => (
            <UpdateRow key={u.lead.id} group={u} />
          ))}
        </Section>
      )}

      {unsaved.length > 0 && (
        <Section
          title="Not sure which job"
          count={unsaved.length}
          hint="The app couldn't tell which job these are about. Pick the job, or add it as a new one."
        >
          {unsaved.map((u) => (
            <UnsavedRow key={u.lead.id} group={u} />
          ))}
        </Section>
      )}

      {/* What the app already handled comes after what still needs you. */}
      {g.moved.length > 0 && <MovedSection events={g.moved} />}

      {confirmations.length > 0 && (
        <Collapsed
          title="Application confirmations"
          count={confirmations.length}
          hint="Companies letting you know they received an application."
        >
          {confirmations.map((u) => (
            <UpdateRow key={u.lead.id} group={u} />
          ))}
        </Collapsed>
      )}

      {g.contacts.length > 0 && (
        <Collapsed
          title="Recruiter messages"
          count={g.contacts.length}
          hint="Recruiters reaching out. Nothing to update."
        >
          {g.contacts.map((ev) => (
            <HiddenRow key={ev.id} ev={ev} />
          ))}
        </Collapsed>
      )}

      {g.hidden.length > 0 && (
        <Collapsed
          title="Hidden"
          count={g.hidden.length}
          hint="Emails that weren't clear enough to act on. Job alerts and ads are left out entirely."
          muted
        >
          {g.hidden.map((ev) => (
            <HiddenRow key={ev.id} ev={ev} />
          ))}
        </Collapsed>
      )}
    </div>
  );
}

function Heading({ title, count, hint }: { title: string; count: number; hint?: string }) {
  return (
    <>
      <h2 className={cn("text-sm font-semibold text-muted-foreground", hint ? "mb-0.5" : "mb-3")}>
        {title} <span className="font-normal">({count})</span>
      </h2>
      {hint && <p className="mb-3 text-xs text-muted-foreground">{hint}</p>}
    </>
  );
}

function ShowAll({ all, total, onToggle }: { all: boolean; total: number; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="mt-1.5 w-full gap-1 text-muted-foreground"
      onClick={onToggle}
      aria-expanded={all}
    >
      {all ? "Show less" : `Show all ${total}`}
      <ChevronDown className={cn("h-4 w-4 transition-transform", all && "rotate-180")} aria-hidden />
    </Button>
  );
}

/** A titled list that shows the newest few rows until asked for the rest. */
function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  children: React.ReactNode;
}) {
  const [all, setAll] = useState(false);
  const rows = Children.toArray(children);
  return (
    <section className="mb-8">
      <Heading title={title} count={count} hint={hint} />
      <ul className="space-y-1.5">{all ? rows : rows.slice(0, SHOWN)}</ul>
      {rows.length > SHOWN && (
        <ShowAll all={all} total={rows.length} onToggle={() => setAll((a) => !a)} />
      )}
    </section>
  );
}

function Collapsed({
  title,
  count,
  hint,
  muted,
  children,
}: {
  title: string;
  count: number;
  hint: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className={cn("mb-4 rounded-lg border", muted && "bg-muted/30")}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="text-sm font-medium">
            {title} ({count})
          </span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && <ul className="space-y-1.5 border-t p-3">{children}</ul>}
    </section>
  );
}

function Icon({ kind, small }: { kind: string; small?: boolean }) {
  const { icon: I, tone } = LOOK[kind] ?? FALLBACK;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        small ? "h-7 w-7" : "mt-0.5 h-8 w-8",
        tone,
      )}
    >
      <I className={small ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
    </span>
  );
}

/** Icon, company, then job · when — one slim block that fits any screen. */
function RowHead({ ev, extra }: { ev: DetectedEvent; extra?: string }) {
  const sub = [ev.company && ev.title, emailWhen(ev), extra].filter(Boolean).join(" · ");
  return (
    <>
      <Icon kind={ev.event_type} small />
      <span className="min-w-0 flex-1" title={sentence(ev)}>
        <span className="block truncate text-sm font-medium">{ev.company || sentence(ev)}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
    </>
  );
}

/** What the email says, and where its card is now versus where it would go. */
function CardLine({ ev }: { ev: DetectedEvent }) {
  const says = SAYS[ev.event_type];
  let card: React.ReactNode = null;
  if (!ev.saved_job_id) {
    if (ev.status === "unsaved") card = "Not on your board yet";
  } else if (ev.target_stage && ev.current_stage === ev.target_stage) {
    card = `Card is already in ${ev.target_stage}`;
  } else if (ev.target_stage) {
    card = (
      <>
        Card: {ev.current_stage ?? "not on the board yet"} →{" "}
        <span className="font-medium text-foreground">{ev.target_stage}</span>
      </>
    );
  }
  if (!says && !card) return null;
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      {says}
      {says && card && " · "}
      {card}
    </p>
  );
}

/** Subject, sender, why, and a link to the email — only when asked for. */
// On a touch screen these text links grow to a size a thumb can hit.
const TOUCH_LINK =
  "pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center pointer-coarse:text-sm";

function Details({ ev }: { ev: DetectedEvent }) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState(false);
  const why = reason(ev);
  return (
    <div className="mt-1">
      <span className="flex flex-wrap gap-3 pointer-coarse:gap-x-5 pointer-coarse:gap-y-0">
        <button
          className={cn("text-xs font-medium text-primary underline-offset-2 hover:underline", TOUCH_LINK)}
          onClick={() => setViewing(true)}
        >
          View email
        </button>
        <button
          className={cn("text-xs text-muted-foreground underline-offset-2 hover:underline", TOUCH_LINK)}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? "Hide details" : "Details"}
        </button>
        {ev.job_listing_id && (
          <Link
            to={`/jobs/${ev.job_listing_id}`}
            className={cn("text-xs text-muted-foreground underline-offset-2 hover:underline", TOUCH_LINK)}
          >
            View the job
          </Link>
        )}
      </span>
      <EmailViewer
        eventId={viewing ? ev.id : null}
        mailLink={ev.mail_link}
        searchLink={ev.mail_search_link}
        onClose={() => setViewing(false)}
      />
      {open && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/40 p-2.5 text-xs">
          <dt className="text-muted-foreground">What</dt>
          <dd>{sentence(ev)}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="break-words">{ev.subject || "(no subject)"}</dd>
          <dt className="text-muted-foreground">From</dt>
          <dd className="break-words">{ev.from_addr}</dd>
          {why && (
            <>
              <dt className="text-muted-foreground">Why</dt>
              <dd>{why}</dd>
            </>
          )}
          {(ev.mail_link || ev.job_listing_id) && (
            <>
              <dt className="text-muted-foreground">Open</dt>
              <dd className="flex flex-wrap gap-3">
                {ev.mail_link && (
                  <a
                    href={ev.mail_link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary underline"
                  >
                    Find the email <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
                {ev.job_listing_id && (
                  <Link to={`/jobs/${ev.job_listing_id}`} className="text-primary underline">
                    View the job
                  </Link>
                )}
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

/** Shown in place of a row after it's applied, with a way back. */
function Done({ ev, onUndo, busy }: { ev: DetectedEvent; onUndo: () => void; busy: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground sm:px-4">
      <span className="flex min-w-0 items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
        <span className="truncate">
          {ev.company ? `${ev.company}: ` : "Updated"}
          {ev.target_stage ? `moved to ${ev.target_stage}` : ""}.
        </span>
      </span>
      <Button size="sm" variant="ghost" className="gap-1" onClick={onUndo} disabled={busy}>
        <Undo2 className="h-3.5 w-3.5" aria-hidden /> Undo
      </Button>
    </li>
  );
}

/** Cards the scan moved by itself: a count per stage, then the newest few. */
function MovedSection({ events }: { events: DetectedEvent[] }) {
  const [stage, setStage] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const stages = new Map<string, { count: number; kind: string }>();
  for (const ev of events) {
    const name = ev.target_stage ?? "Other";
    const s = stages.get(name);
    stages.set(name, { count: (s?.count ?? 0) + 1, kind: s?.kind ?? ev.event_type });
  }
  const list = stage ? events.filter((ev) => (ev.target_stage ?? "Other") === stage) : events;
  const shown = all ? list : list.slice(0, SHOWN);
  const pick = (name: string | null) => {
    setStage(name);
    setAll(false);
  };

  return (
    <section className="mb-8">
      <Heading
        title="Moved for you"
        count={events.length}
        hint="The app was sure which job these were about, so the card moved by itself. Tap one to see the email, or undo it if it's the wrong job."
      />
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Show by stage">
        <Chip active={stage === null} onClick={() => pick(null)}>
          All {events.length}
        </Chip>
        {[...stages].map(([name, s]) => (
          <Chip
            key={name}
            active={stage === name}
            tone={(LOOK[s.kind] ?? FALLBACK).tone}
            onClick={() => pick(stage === name ? null : name)}
          >
            {s.count} {name}
          </Chip>
        ))}
      </div>
      <ul className="space-y-1.5">
        {shown.map((ev) => (
          <MovedRow key={ev.id} ev={ev} />
        ))}
      </ul>
      {list.length > SHOWN && (
        <ShowAll all={all} total={list.length} onToggle={() => setAll((a) => !a)} />
      )}
    </section>
  );
}

function Chip({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:px-4 pointer-coarse:text-sm",
        active ? "border-foreground/30 ring-1 ring-foreground/20" : "border-transparent",
        tone ?? "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** One slim line per moved card; tap it for the email, the job, and Undo. */
function MovedRow({ ev }: { ev: DetectedEvent }) {
  const review = useReviewEvent();
  const unlink = useUnlinkEvent();
  // Placed by the app from the company alone: Undo also lists the email
  // again, so it can go on the right job.
  const guessed = ev.match_evidence === "likely_job";
  const undoing = guessed ? unlink : review;
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [undone, setUndone] = useState(false);
  const tone = (LOOK[ev.event_type] ?? FALLBACK).tone;
  const why = reason(ev);
  if (undone)
    return (
      <li className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
        <Undo2 className="h-4 w-4" aria-hidden />
        {guessed
          ? "Put back. Pick the right job under \u201cNot sure which job\u201d above."
          : "Put back where it was."}
      </li>
    );
  return (
    <li className="rounded-lg border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted/40 sm:px-4"
      >
        <RowHead ev={ev} />
        {ev.target_stage && (
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
            {ev.target_stage}
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div className="space-y-2.5 border-t px-3 py-3 [overflow-wrap:anywhere] sm:px-4">
          <p className="text-sm leading-snug">
            {sentence(ev)}
            {ev.target_stage && (
              <span className="text-muted-foreground">
                {" "}
                The card moved to {ev.target_stage}.
                {ev.current_stage &&
                  ev.current_stage !== ev.target_stage &&
                  ` It's in ${ev.current_stage} now.`}
              </span>
            )}
          </p>
          {why && <p className="text-xs text-muted-foreground">{why}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setViewing(true)}>
              <MailCheck className="h-3.5 w-3.5" aria-hidden /> View email
            </Button>
            {ev.job_listing_id && (
              <Button size="sm" variant="outline" asChild>
                <Link to={`/jobs/${ev.job_listing_id}`}>
                  <Briefcase className="h-3.5 w-3.5" aria-hidden /> View the job
                </Link>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={undoing.isPending}
              onClick={() =>
                guessed
                  ? unlink.mutate({ lead: ev.id, repeats: [] }, { onSuccess: () => setUndone(true) })
                  : review.mutate({ id: ev.id, action: "undo" }, { onSuccess: () => setUndone(true) })
              }
            >
              {undoing.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Undo2 className="h-3.5 w-3.5" aria-hidden />
              )}
              {guessed ? "Wrong job" : "Undo"}
            </Button>
          </div>
          {undoing.isError && (
            <p className="text-xs text-destructive">
              {errorText(undoing.error, "That didn't work. Try again.")}
            </p>
          )}
          <EmailViewer
        eventId={viewing ? ev.id : null}
        mailLink={ev.mail_link}
        searchLink={ev.mail_search_link}
        onClose={() => setViewing(false)}
      />
        </div>
      )}
    </li>
  );
}

/** A slim row: what it's about on the left, its buttons right — on a phone,
 * the buttons come last, after what the email says and where the card is. */
function SlimRow({
  ev,
  extra,
  actions,
  children,
}: {
  ev: DetectedEvent;
  extra?: string;
  actions: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-1 rounded-lg border bg-card px-3 py-2.5 sm:grid-cols-[1fr_auto] sm:gap-x-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <RowHead ev={ev} extra={extra} />
      </div>
      <div className="min-w-0 pl-10 [overflow-wrap:anywhere]">
        <CardLine ev={ev} />
        {children}
        <Details ev={ev} />
      </div>
      {/* On a phone the buttons share the row's full width, the main one first. */}
      <div className="mt-1 flex items-center gap-2 max-sm:flex-wrap max-sm:*:flex-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:flex-wrap sm:gap-1.5 sm:self-center">
        {actions}
      </div>
    </li>
  );
}

function UpdateRow({ group: u }: { group: UpdateGroup }) {
  const ev = u.lead;
  const groupAct = useGroupAction();
  const review = useReviewEvent();
  const unlink = useUnlinkEvent();
  const [done, setDone] = useState(false);
  const [sentBack, setSentBack] = useState(false);
  const busy = groupAct.isPending || review.isPending || unlink.isPending;
  const guessed = ev.match_evidence === "likely_job";
  const act = (action: "apply" | "dismiss") =>
    groupAct.mutate(
      { lead: ev, repeats: u.repeats, action },
      { onSuccess: () => setDone(action === "apply") },
    );
  const undo = () =>
    review.mutate({ id: ev.id, action: "undo" }, { onSuccess: () => setDone(false) });

  if (done) return <Done ev={ev} onUndo={undo} busy={busy} />;
  if (sentBack)
    return (
      <li className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
        <Undo2 className="h-4 w-4" aria-hidden />
        Sent back. Pick the right job under “Not sure which job”.
      </li>
    );
  const more = u.repeats.length;
  return (
    <SlimRow
      ev={ev}
      extra={more > 0 ? `${more + 1} emails` : undefined}
      actions={
        <>
          <Button size="sm" onClick={() => act("apply")} disabled={busy || ev.stage_missing}>
            {groupAct.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {!ev.target_stage
              ? "Apply update"
              : ev.current_stage === ev.target_stage
                ? "Got it"
                : `Move to ${ev.target_stage}`}
          </Button>
          {guessed ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                unlink.mutate({ lead: ev.id, repeats: [] }, { onSuccess: () => setSentBack(true) })
              }
            >
              Wrong job
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => act("dismiss")} disabled={busy}>
              Not this
            </Button>
          )}
        </>
      }
    >
      {ev.stage_missing && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          Your “{ev.target_stage}” stage no longer exists, so this can't be applied.
        </p>
      )}
      {(groupAct.isError || review.isError || unlink.isError) && (
        <p className="mt-1 text-xs text-destructive">
          {errorText(groupAct.error ?? review.error ?? unlink.error, "That didn't work. Try again.")}
        </p>
      )}
    </SlimRow>
  );
}

function QuestionRow({ ev }: { ev: DetectedEvent }) {
  const answer = useAnswerQuestion();
  const review = useReviewEvent();
  const [done, setDone] = useState<DetectedEvent | null>(null);
  const company = new Set((ev.candidates ?? []).map((c) => c.company)).size === 1;
  const busy = answer.isPending || review.isPending;

  if (done)
    return (
      <Done
        ev={done}
        busy={review.isPending}
        onUndo={() => review.mutate({ id: ev.id, action: "undo" }, { onSuccess: () => setDone(null) })}
      />
    );
  return (
    <li className="flex gap-3 rounded-lg border border-amber-500/40 bg-card px-3 py-3 sm:px-4">
      <Icon kind={ev.event_type} small />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p className="text-sm font-medium leading-snug">{question(ev)}</p>
        <p className="text-xs text-muted-foreground">
          {emailWhen(ev)} · Pick the job to update its card.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(ev.candidates ?? []).map((c) =>
            c.saved_job_id ? (
              <Button
                key={c.saved_job_id}
                size="sm"
                variant="outline"
                className="h-auto whitespace-normal py-1.5 text-left"
                disabled={busy}
                onClick={() =>
                  answer.mutate(
                    { id: ev.id, savedJobId: c.saved_job_id! },
                    { onSuccess: (applied) => setDone(applied) },
                  )
                }
              >
                {company ? c.title : `${c.company} — ${c.title}`}
              </Button>
            ) : null,
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => review.mutate({ id: ev.id, action: "dismiss" })}
          >
            None of these
          </Button>
        </div>
        {(answer.isError || review.isError) && (
          <p className="mt-1 text-xs text-destructive">
            {errorText(answer.error ?? review.error, "That didn't work. Try again.")}
          </p>
        )}
        <Details ev={ev} />
      </div>
    </li>
  );
}

/** An important update about a job the scan couldn't place. One clear
 * choice: pick the saved job it's about (the main button; likely jobs are
 * listed first), add it as a new job, or dismiss it. Updates the app can
 * place by the company alone never get here: each scan puts them on the job. */
function UnsavedRow({ group: u }: { group: UpdateGroup }) {
  const ev = u.lead;
  const track = useTrackEvent();
  const link = useLinkEvent();
  const unlink = useUnlinkEvent();
  const groupAct = useGroupAction();
  const [editing, setEditing] = useState(false);
  const [company, setCompany] = useState(ev.company ?? "");
  const [title, setTitle] = useState(ev.title ?? "");
  const [added, setAdded] = useState<DetectedEvent | null>(null);
  const [linked, setLinked] = useState<{ done: DetectedEvent; repeats: string[] } | null>(
    null,
  );
  const [picking, setPicking] = useState(false);
  const busy = track.isPending || link.isPending || groupAct.isPending;
  const more = u.repeats.length;
  // Repeats are the same job only when the email named the role; otherwise
  // they may be other roles at the company, so they stay on the page.
  const sameJob = ev.title ? u.repeats : [];

  const addNew = () => {
    if (!company.trim() || !title.trim()) {
      setEditing(true);
      return;
    }
    track.mutate(
      { lead: ev, repeats: sameJob, company: company.trim(), title: title.trim() },
      { onSuccess: (done) => setAdded(done) },
    );
  };
  const linkTo = (savedJobId: string) =>
    link.mutate(
      { lead: ev, repeats: sameJob, savedJobId },
      {
        onSuccess: (result) => {
          setPicking(false);
          setLinked(result);
        },
      },
    );

  if (linked) {
    const job = linked.done;
    return (
      <li className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground sm:px-4">
        <span className="flex min-w-0 items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
          <span className="min-w-0">
            Put on {job.title ?? "your job"}
            {job.current_stage ? `, now in ${job.current_stage}` : ""}.
            {unlink.isError && (
              <span className="block text-xs text-destructive">Couldn&apos;t undo. Try again.</span>
            )}
          </span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1"
          disabled={unlink.isPending}
          onClick={() =>
            unlink.mutate(
              { lead: job.id, repeats: linked.repeats },
              { onSuccess: () => setLinked(null) },
            )
          }
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden /> Undo
        </Button>
      </li>
    );
  }
  if (added)
    return (
      <li className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
        Added to My Jobs{added.target_stage ? ` in ${added.target_stage}` : ""}.
      </li>
    );
  return (
    <SlimRow
      ev={ev}
      extra={more > 0 ? `${more + 1} emails` : undefined}
      actions={
        editing ? (
          <>
            <Button size="sm" onClick={addNew} disabled={busy}>
              {track.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Save to My Jobs
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {/* The main choice gets the whole first line on a phone. */}
            <Button
              size="sm"
              className="gap-1 max-sm:basis-full!"
              disabled={busy}
              onClick={() => {
                link.reset();
                setPicking(true);
              }}
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              Pick the job
            </Button>
            <Button size="sm" variant="outline" onClick={addNew} disabled={busy}>
              {track.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Add as new job
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => groupAct.mutate({ lead: ev, repeats: u.repeats, action: "dismiss" })}
            >
              Dismiss
            </Button>
          </>
        )
      }
    >
      <JobPicker
        source={{ event: ev.id }}
        open={picking}
        onOpenChange={setPicking}
        title="Which job is this about?"
        description="Pick the job this email is about. Its card moves forward to match the email, and later emails from this sender go there by themselves."
        onPick={(o) => linkTo(o.saved_job_id)}
        busy={busy}
        error={link.isError ? errorText(link.error, "Couldn't link that. Try again.") : null}
        footer={
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setPicking(false);
              addNew();
            }}
          >
            It&apos;s not saved: add it as a new job
          </Button>
        }
      />
      {editing && (
        <p className="mt-2 text-xs text-muted-foreground">
          The email didn&apos;t say clearly. Check the company and the job title.
        </p>
      )}
      {editing && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input
            aria-label="Company"
            placeholder="Company, e.g. Vellacor"
            className="h-8 rounded-md border bg-background px-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <input
            aria-label="Job title"
            placeholder="Job title, e.g. Platform Engineer"
            className="h-8 rounded-md border bg-background px-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      )}
      {(track.isError || groupAct.isError || (link.isError && !picking)) && (
        <p className="mt-1 text-xs text-destructive">
          {errorText(track.error ?? groupAct.error ?? link.error, "That didn't work. Try again.")}
        </p>
      )}
    </SlimRow>
  );
}

function HiddenRow({ ev }: { ev: DetectedEvent }) {
  const review = useReviewEvent();
  return (
    <SlimRow
      ev={ev}
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => review.mutate({ id: ev.id, action: "dismiss" })}
          disabled={review.isPending}
        >
          Remove
        </Button>
      }
    />
  );
}
