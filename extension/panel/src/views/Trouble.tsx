// Never stuck (spec 017): every failure — no form, nothing matched, a page
// that needs a refresh, a fill that took too long, something left unfilled —
// offers the same actions: read the page again (a fresh reader in every
// frame), point at a box (teach it), and copy what Job Catcher saw (a report
// with no values or personal details) to paste to Claude.
import * as React from "react";
import { ClipboardCopy, MousePointerClick, RefreshCw } from "lucide-react";
import { Button, InfoBubble, Muted, Textarea } from "@/ui";
import { HELP } from "@/lib/help";
import { copyText, send } from "@/lib/chrome";
import { formatReport } from "../../../src/autofill/report.js";

export function Trouble({ tabId, onPoint, quiet = false }: { tabId: number | null; onPoint?: () => void; quiet?: boolean }) {
  const [reading, setReading] = React.useState(false);
  const [read, setRead] = React.useState<string>("");
  const [copied, setCopied] = React.useState<"" | "ok" | "failed">("");
  const [text, setText] = React.useState("");
  if (tabId == null) return null;

  async function readAgain() {
    setReading(true);
    setRead("");
    const res = await send({ type: "readAgain", tabId });
    setReading(false);
    if (!res?.ok) setRead("Chrome doesn't let extensions read this page.");
    else setRead(res.form ? `Read again: found ${res.fields} box${res.fields === 1 ? "" : "es"}.` : "Read again: still no boxes Job Catcher can fill.");
  }

  async function copy() {
    const res = await send({ type: "scanReport", tabId });
    const report = formatReport(res?.report || { version: "?", host: "", frames: [] });
    setText(report);
    setCopied((await copyText(report)) ? "ok" : "failed"); // failed: shown below to copy by hand
  }

  return (
    <div className="flex flex-col gap-2" data-testid="trouble">
      {quiet && <p className="text-[11px] text-muted-foreground">Something not filled?</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" busy={reading} onClick={readAgain}>
          {!reading && <RefreshCw />}
          Read the page again
        </Button>
        {onPoint && (
          <Button variant="outline" size="sm" onClick={onPoint}>
            <MousePointerClick />
            Point at a box
          </Button>
        )}
        {onPoint && <InfoBubble help={HELP.pointAtBox} />}
        <Button variant="ghost" size="sm" onClick={copy}>
          <ClipboardCopy />
          Copy what Job Catcher saw
        </Button>
      </div>
      {read && (
        <Muted role="status" aria-live="polite">
          {read}
        </Muted>
      )}
      {copied === "ok" && (
        <Muted role="status" aria-live="polite">
          Copied. Paste it to Claude: it has the page's questions, never your answers.
        </Muted>
      )}
      {copied === "failed" && <Textarea readOnly value={text} rows={6} aria-label="What Job Catcher saw" />}
    </div>
  );
}
