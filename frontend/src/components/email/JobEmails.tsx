/**
 * "Emails about this job": every detected email tied to a saved job, newest
 * first. This is the answer to "why is this job in Phone Screen?": each line
 * says what the email was and what it did to the card, opens the email here
 * for a quick read, or opens it in the user's own mail to use its links.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Mail } from "lucide-react";
import {
  useJobEmails,
  useMarkJobEmailsSeen,
  useUnkeep,
  type DetectedEvent,
} from "@/hooks/useEmailAccount";
import { groupBySection, isNew, latestLine } from "@/lib/emailSections";
import { emailWhen, mailName, sentence } from "@/lib/emailUpdates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmailViewer } from "@/components/email/EmailViewer";

/** What the email did to the job's card. */
function effect(ev: DetectedEvent): string | null {
  const moved = ev.status === "applied" || ev.status === "auto_applied";
  if (moved && ev.target_stage) {
    return ev.status === "auto_applied"
      ? `Moved this job to ${ev.target_stage} automatically`
      : `You moved this job to ${ev.target_stage}`;
  }
  if (ev.status === "pending") return "Waiting for you on Email updates";
  if (ev.status === "noted") {
    // Kept on the job; the card didn't need to move (spec 027).
    return ev.current_stage
      ? `No change needed (job is in ${ev.current_stage})`
      : "No change needed";
  }
  return null;
}

export function JobEmails({
  jobListingId,
  className,
  sayWhenNone = false,
}: {
  jobListingId: string;
  className?: string;
  /** With no emails, say so (the job's own page) instead of showing nothing. */
  sayWhenNone?: boolean;
}) {
  const {
    data: emails,
    isError,
    refetch,
    isFetching,
  } = useJobEmails(jobListingId);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState<Record<string, boolean>>({});
  // What was new stays marked New for this visit, even after the app hears
  // it was seen; read only from fresh data, and per job (spec 027).
  const [fresh, setFresh] = useState<{ job: string; ids: Set<string> }>({
    job: jobListingId,
    ids: new Set(),
  });
  const { mutate: markSeen } = useMarkJobEmailsSeen();
  const unkeep = useUnkeep();
  const posted = useRef(new Set<string>());
  useEffect(() => {
    if (!emails || isFetching) return;
    const unseen = emails.filter(isNew).map((e) => e.id);
    if (!unseen.length) return;
    setFresh((prev) => ({
      job: jobListingId,
      ids: new Set([...(prev.job === jobListingId ? prev.ids : []), ...unseen]),
    }));
    if (unseen.some((id) => !posted.current.has(id))) {
      unseen.forEach((id) => posted.current.add(id));
      markSeen(jobListingId);
    }
  }, [emails, isFetching, jobListingId, markSeen]);
  const freshIds = fresh.job === jobListingId ? fresh.ids : new Set<string>();
  if (!emails) {
    // Where the job's emails are expected (its page and pop-up), say what's
    // happening instead of leaving a gap that looks like "no emails".
    if (!sayWhenNone) return null;
    if (!isError)
      return <Skeleton className={cn("h-11 rounded-lg", className)} />;
    return (
      <p
        role="alert"
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground",
          className,
        )}
      >
        Couldn&apos;t check for emails about this job.
        <button
          type="button"
          disabled={isFetching}
          onClick={() => refetch()}
          className="font-medium text-primary underline underline-offset-2"
        >
          Try again
        </button>
      </p>
    );
  }
  if (emails.length === 0) {
    if (!sayWhenNone) return null;
    return (
      <p
        className={cn(
          "rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground",
          className,
        )}
      >
        No email is linked to this job, so its stage was set by hand. Expecting
        one?{" "}
        <Link
          to="/email-updates"
          className="font-medium text-primary underline underline-offset-2"
        >
          Scan your inbox
        </Link>
      </p>
    );
  }
  const viewing = emails.find((e) => e.id === open);
  const latest = latestLine(emails);
  return (
    <section className={className}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Mail className="h-4 w-4" aria-hidden /> Emails about this job (
        {emails.length})
      </h2>
      {latest && (
        <p className="mb-3 mt-0.5 text-xs text-muted-foreground">{latest}</p>
      )}
      <div className="space-y-4">
        {groupBySection(emails).map((sec) => {
          const shown = all[sec.key] ? sec.emails : sec.emails.slice(0, 3);
          return (
            <div key={sec.key} role="group" aria-label={sec.title}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {sec.title}{" "}
                <span className="font-normal">({sec.emails.length})</span>
              </h3>
              <ul className="space-y-2">
                {shown.map((ev) => {
                  const did = effect(ev);
                  const isFresh = freshIds.has(ev.id);
                  return (
                    <li
                      key={ev.id}
                      className={cn(
                        "flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4",
                        isFresh && "border-primary/50",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-sm leading-snug">
                          {isFresh && (
                            <span className="mr-1.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">
                              New
                            </span>
                          )}
                          {sentence(ev)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {emailWhen(ev)}
                          {did ? ` · ${did}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2 max-sm:*:flex-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setOpen(ev.id)}
                        >
                          View email
                        </Button>
                        {ev.status === "noted" &&
                          ev.match_evidence === "user_link" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={unkeep.isPending}
                              onClick={() => unkeep.mutate(ev.id)}
                            >
                              Not this job
                            </Button>
                          )}
                        {ev.mail_link && (
                          <Button
                            asChild
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                          >
                            <a
                              href={ev.mail_link}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open in {mailName(ev.mail_link)}
                              <ExternalLink
                                className="h-3.5 w-3.5"
                                aria-hidden
                              />
                            </a>
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {sec.emails.length > 3 && (
                <button
                  type="button"
                  className="mt-1.5 min-h-9 text-sm font-medium text-primary underline underline-offset-2"
                  onClick={() =>
                    setAll((a) => ({ ...a, [sec.key]: !a[sec.key] }))
                  }
                >
                  {all[sec.key]
                    ? "Show fewer"
                    : `Show ${sec.emails.length - 3} more`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <EmailViewer
        eventId={open}
        mailLink={viewing?.mail_link}
        searchLink={viewing?.mail_search_link}
        onClose={() => setOpen(null)}
      />
    </section>
  );
}
