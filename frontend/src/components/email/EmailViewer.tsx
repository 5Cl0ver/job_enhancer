/**
 * Shows one detected email, fetched read-only from the user's mailbox when the
 * dialog opens. The text is plain (the server never sends email HTML), so it is
 * rendered as text — nothing in an email can run or load here.
 */
import { ExternalLink, Loader2, Mail } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useEmailMessage } from "@/hooks/useEmailAccount";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function EmailViewer({
  eventId,
  onClose,
}: {
  eventId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useEmailMessage(eventId);
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
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening your email…
          </p>
        )}
        {isError && (
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : "Couldn't open this email."}
          </p>
        )}
        {data && (
          <>
            <div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
              {data.text || "(This email has no readable text — it may be images only.)"}
            </div>
            {data.mail_link && (
              <Button asChild variant="outline" size="sm" className="w-fit gap-1.5">
                <a href={data.mail_link} target="_blank" rel="noreferrer">
                  Open in your mail <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
