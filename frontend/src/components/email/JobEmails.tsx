/**
 * "Emails about this job" on a saved job's page: every detected email tied to
 * it, newest first, each one opening in the email viewer.
 */
import { useState } from "react";
import { Mail } from "lucide-react";
import { useJobEmails } from "@/hooks/useEmailAccount";
import { sentence } from "@/lib/emailUpdates";
import { Button } from "@/components/ui/button";
import { EmailViewer } from "@/components/email/EmailViewer";

const STATUS: Record<string, string> = {
  pending: "Waiting for you on Email updates",
  applied: "Applied to the card",
  auto_applied: "Moved the card automatically",
};

export function JobEmails({ jobListingId }: { jobListingId: string }) {
  const { data: emails } = useJobEmails(jobListingId);
  const [open, setOpen] = useState<string | null>(null);
  if (!emails || emails.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Mail className="h-4 w-4" aria-hidden /> Emails about this job ({emails.length})
      </h2>
      <ul className="space-y-2">
        {emails.map((ev) => (
          <li
            key={ev.id}
            className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-sm leading-snug">{sentence(ev)}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(ev.created_at).toLocaleDateString()}
                {STATUS[ev.status] ? ` · ${STATUS[ev.status]}` : ""}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setOpen(ev.id)}>
              View email
            </Button>
          </li>
        ))}
      </ul>
      <EmailViewer eventId={open} onClose={() => setOpen(null)} />
    </section>
  );
}
