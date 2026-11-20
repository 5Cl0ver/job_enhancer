/**
 * Shows one detected email, fetched read-only from the user's mailbox when the
 * dialog opens: a quick read without leaving the app. The text is plain (the
 * server never sends email HTML), so it is rendered as text — nothing in an
 * email can run or load here. To use the email's links, "Open in Yahoo Mail"
 * goes to the message itself in the user's own mail; if that doesn't land on
 * it, there's a search for it.
 */
import { ExternalLink, Loader2, Mail } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useEmailMessage } from "@/hooks/useEmailAccount";
import { mailName } from "@/lib/emailUpdates";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** The way out to the user's own mail: the message itself, and a search for it
 * in case the direct link doesn't land. */
function MailLinks({ link, search }: { link?: string | null; search?: string | null }) {
  if (!link && !search) return null;
  const main = link ?? search!;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button asChild size="sm" className="gap-1.5">
        <a href={main} target="_blank" rel="noreferrer">
          Open in {mailName(main)} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </Button>
      {link && search && search !== link && (
        <a
          href={search}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Didn&apos;t open it? Search for it
        </a>
      )}
    </div>
  );
}

export function EmailViewer({
  eventId,
  mailLink,
  searchLink,
  onClose,
}: {
  eventId: string | null;
  /** The email in the user's webmail, known before the email itself loads. */
  mailLink?: string | null;
  searchLink?: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useEmailMessage(eventId);
  const gone = error instanceof ApiError && error.status === 404;
  return (
    <Dialog open={!!eventId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 text-base leading-snug">
            <Mail className="h-4 w-4 shrink-0" aria-hidden />
            <span className="break-words">{data?.subject || "Email"}</span>
          </DialogTitle>
          {data && (
            <DialogDescription className="break-words text-xs">
              {data.from_addr}
              {data.date ? ` · ${new Date(data.date).toLocaleString()}` : ""}
            </DialogDescription>
          )}
        </DialogHeader>
        {isLoading && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening your email…
            </p>
            {/* The way out to the mail site is known already: no need to wait
                for the text to load to use it. */}
            <MailLinks link={mailLink} search={searchLink} />
          </div>
        )}
        {isError && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {gone
                ? "This email couldn't be opened here — it may have been moved to another folder or deleted."
                : error instanceof ApiError
                  ? error.message
                  : "Couldn't open this email. Try again."}
            </p>
            <MailLinks link={mailLink} search={searchLink} />
          </div>
        )}
        {data && (
          <>
            <div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
              {data.text || "(This email has no readable text — it may be images only.)"}
            </div>
            <MailLinks
              link={data.mail_link ?? mailLink}
              search={data.mail_search_link ?? searchLink}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
