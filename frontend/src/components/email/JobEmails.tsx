/**
 * "Emails about this job": every detected email tied to a saved job, newest
 * first. This is the answer to "why is this job in Phone Screen?": each line
 * says what the email was and what it did to the card, opens the email here
 * for a quick read, or opens it in the user's own mail to use its links.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Mail } from "lucide-react";
import { useJobEmails, type DetectedEvent } from "@/hooks/useEmailAccount";
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
    return ev.current_stage ? `No change needed (job is in ${ev.current_stage})` : "No change needed";
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
  return (
    <section className={className}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Mail className="h-4 w-4" aria-hidden /> Emails about this job (
        {emails.length})
      </h2>
      <ul className="space-y-2">
        {emails.map((ev) => {
          const did = effect(ev);
          return (
            <li
              key={ev.id}
              className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4"
            >
              <div className="min-w-0">
                <p className="text-sm leading-snug">{sentence(ev)}</p>
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
                {ev.mail_link && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                  >
                    <a href={ev.mail_link} target="_blank" rel="noreferrer">
                      Open in {mailName(ev.mail_link)}
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <EmailViewer
        eventId={open}
        mailLink={viewing?.mail_link}
        searchLink={viewing?.mail_search_link}
        onClose={() => setOpen(null)}
      />
    </section>
  );
}
