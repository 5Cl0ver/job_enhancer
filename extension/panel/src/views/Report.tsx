// "Report a problem here" (spec 032): the app's owner only. A short note on
// what happened, sent to Bugs & ideas with the page (its site and path, never
// the query), Job Catcher's version and, if ticked, a picture of the page.
// It sits under This page and never blocks the rest of the panel.
import * as React from "react";
import { Bug, Send } from "lucide-react";
import { Alert, Button, Field, Textarea } from "@/ui";
import { send } from "@/lib/chrome";
import { usePanel } from "@/lib/store";

const PICTURE_SAYS: Record<string, string> = {
  sent: "Sent to Bugs & ideas, with a picture of the page.",
  none: "Sent to Bugs & ideas.",
  failed: "Sent to Bugs & ideas. The picture didn't go.",
  not_showing: "Sent to Bugs & ideas, without a picture: the page wasn't showing.",
  changed: "Sent to Bugs & ideas, without a picture: the page changed.",
};

export function ReportProblem() {
  const { auth, tab } = usePanel();
  const [open, setOpen] = React.useState(false);
  const [what, setWhat] = React.useState("");
  const [picture, setPicture] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<{ ok: boolean; text: string } | null>(null);
  React.useEffect(() => setDone(null), [tab.url]); // "Sent" was about the last page

  // Owner only, and only on a web page (there's a page to name).
  if (!auth.isOwner || tab.id == null || !/^https?:\/\//i.test(tab.url)) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!what.trim() || busy) return;
    setBusy(true);
    setDone(null);
    const res = await send({ type: "reportProblem", tabId: tab.id, what: what.trim(), picture });
    setBusy(false);
    if (res?.ok) {
      setDone({ ok: true, text: PICTURE_SAYS[String(res.picture)] || PICTURE_SAYS.none });
      setWhat("");
      setPicture(false);
      setOpen(false);
    } else {
      setDone({ ok: false, text: res?.error || "Couldn't send it. Try again." });
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3" data-testid="report-problem">
      {!open && (
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1.5 self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setOpen(true);
            setDone(null);
          }}
        >
          <Bug className="size-3.5" aria-hidden />
          Report a problem here
        </button>
      )}
      {open && (
        <form className="flex flex-col gap-2" onSubmit={submit} aria-label="Report a problem">
          <Field label="What happened?">
            {(id) => (
              <Textarea
                id={id}
                autoFocus
                required
                rows={3}
                maxLength={2000}
                placeholder="The résumé didn't attach"
                value={what}
                onChange={(e) => setWhat(e.target.value)}
              />
            )}
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={picture}
              onChange={(e) => setPicture(e.target.checked)}
            />
            Add a picture of this page
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" busy={busy} disabled={!what.trim()}>
              {!busy && <Send />}
              Send
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {done && <Alert tone={done.ok ? "success" : "error"}>{done.text}</Alert>}
    </div>
  );
}
