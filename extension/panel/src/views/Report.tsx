// "Report a problem here" (spec 032): the app's owner only. A short note on
// what happened, sent to Bugs & ideas with the page (its site and path, never
// the query), Job Catcher's version and, if ticked, a picture of the page.
// It sits under This page and never blocks the rest of the panel. A note is
// always about the page it was written on: moving to another page closes the
// form (the note is kept to send again here).
import * as React from "react";
import { Bug, Send } from "lucide-react";
import { Alert, Button, Field, Textarea } from "@/ui";
import { send } from "@/lib/chrome";
import { usePanel } from "@/lib/store";
import { placeOf } from "../../../src/background/bugReports.js";

const PICTURE_SAYS: Record<string, string> = {
  sent: "Sent to Bugs & ideas, with a picture of the page.",
  none: "Sent to Bugs & ideas.",
  failed: "Sent to Bugs & ideas. The picture didn't go.",
  not_showing: "Sent to Bugs & ideas, without a picture: the page wasn't showing.",
  changed: "Sent to Bugs & ideas, without a picture: the page changed.",
};

type Said = { tone: "success" | "error" | "info"; text: string };

export function ReportProblem() {
  const { auth, tab } = usePanel();
  const page: string = placeOf(tab.url);
  // The page the open form is about (null: closed).
  const [openOn, setOpenOn] = React.useState<string | null>(null);
  const [what, setWhat] = React.useState("");
  const [picture, setPicture] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [said, setSaid] = React.useState<Said | null>(null);

  // Another page: what was said was about the last one, and an open form
  // closes rather than send its note with the wrong page.
  React.useEffect(() => {
    if (openOn != null && openOn !== page && !busy) {
      setOpenOn(null);
      setSaid({ tone: "info", text: "The page changed, so the report closed. Your note is kept: open it again to report this page." });
    } else if (openOn == null) {
      setSaid(null);
    }
    // Only when the page changes (openOn and busy are read as they are then).
  }, [page]);

  // Owner only, and only on a web page (there's a page to name).
  if (!auth.isOwner || tab.id == null || !page) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!what.trim() || busy || openOn == null) return;
    setBusy(true);
    setSaid(null);
    const res = await send({ type: "reportProblem", tabId: tab.id, page: openOn, what: what.trim(), picture });
    setBusy(false);
    if (res?.ok) {
      setSaid({ tone: "success", text: PICTURE_SAYS[String(res.picture)] || PICTURE_SAYS.none });
      setWhat("");
      setPicture(false);
      setOpenOn(null);
    } else {
      setSaid({ tone: "error", text: res?.error || "Couldn't send it. Try again." });
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3" data-testid="report-problem">
      {openOn == null && (
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1.5 self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setOpenOn(page);
            setSaid(null);
          }}
        >
          <Bug className="size-3.5" aria-hidden />
          Report a problem here
        </button>
      )}
      {openOn != null && (
        <form className="flex flex-col gap-2" onSubmit={submit} aria-label="Report a problem">
          <p className="truncate text-[11px] text-muted-foreground" title={openOn}>
            About {openOn}
          </p>
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
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpenOn(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {said && <Alert tone={said.tone}>{said.text}</Alert>}
    </div>
  );
}
