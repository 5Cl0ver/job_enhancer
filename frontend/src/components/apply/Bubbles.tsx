import { useState } from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { type AnswerSource, type ApplyPage, type Fix, type PageAnswer, SOURCE_LABEL, sourceOf } from "@/lib/apply";

const TONE: Record<AnswerSource, string> = {
  agreement: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  guess: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  claude: "bg-primary/10 text-primary",
  job_catcher: "bg-muted text-muted-foreground",
  page: "bg-muted text-muted-foreground",
};

export function SourceChip({ source }: { source: AnswerSource }) {
  return <span className={cn("shrink-0 rounded px-1.5 text-xs", TONE[source])}>{SOURCE_LABEL[source]}</span>;
}

/**
 * One answer as a bubble (spec 026): the question, what's in the box, who put
 * it there, and the fix waiting to go (if any). Tap it to change it or to ask
 * Claude about it.
 */
export function AnswerBubble({
  page,
  answer,
  fix,
  onTap,
  showPage = false,
}: {
  page: ApplyPage;
  answer: PageAnswer;
  fix?: Fix;
  onTap?: () => void;
  showPage?: boolean;
}) {
  const source = sourceOf(answer);
  const empty = !answer.a.trim();
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-xs text-muted-foreground">
          {showPage && `Page ${page.n} · `}
          {answer.q}
        </span>
        {source !== "page" && <SourceChip source={source} />}
      </span>
      <span
        className={cn(
          "block whitespace-pre-wrap break-words text-sm",
          empty && "text-amber-600 dark:text-amber-400",
          fix?.to && "line-through opacity-60",
        )}
      >
        {empty ? "Left empty" : answer.a}
      </span>
      {fix?.to && <span className="block text-sm font-medium text-primary">→ {fix.to}</span>}
      {fix?.ask && (
        <span className="flex items-start gap-1 text-sm text-primary">
          <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {fix.ask}
        </span>
      )}
    </>
  );
  const shape = cn(
    "block w-full space-y-0.5 rounded-xl border px-3 py-2 text-left",
    fix && "border-primary/60 bg-primary/5",
  );
  if (!onTap) return <div className={shape}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(shape, "min-h-11 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring")}
      aria-label={`${answer.q}: ${empty ? "left empty" : answer.a}. Tap to change or ask Claude.`}
    >
      {body}
    </button>
  );
}

/** Change one answer, or ask Claude about it; nothing is sent until Send fixes. */
export function FixSheet({
  target,
  current,
  onSave,
  onRemove,
  onClose,
}: {
  target: { page: ApplyPage; answer: PageAnswer } | null;
  current?: Fix;
  onSave: (fix: Fix) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [to, setTo] = useState(current?.to ?? "");
  const [ask, setAsk] = useState(current?.ask ?? "");
  if (!target) return null;
  const { page, answer } = target;
  const save = () => {
    onSave({
      page: page.n,
      q: answer.q,
      a: answer.a,
      ...(to.trim() ? { to: to.trim() } : {}),
      ...(ask.trim() ? { ask: ask.trim() } : {}),
    });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[95dvh] max-w-md overflow-y-auto">
        <DialogTitle className="text-base">{answer.q}</DialogTitle>
        <DialogDescription>
          Page {page.n}. Now: {answer.a.trim() || "left empty"}
        </DialogDescription>
        <div className="space-y-1.5">
          <Label htmlFor="fix-to">Change it to</Label>
          <Input
            id="fix-to"
            value={to}
            maxLength={1900}
            placeholder={answer.a || "Your answer"}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fix-ask">Or ask Claude about it</Label>
          <Input
            id="fix-ask"
            value={ask}
            maxLength={480}
            placeholder="Is this right?"
            onChange={(e) => setAsk(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!to.trim() && !ask.trim()} onClick={save}>
            {current ? "Update fix" : "Add fix"}
          </Button>
          {current && (
            <Button
              variant="ghost"
              onClick={() => {
                onRemove();
                onClose();
              }}
            >
              Remove fix
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Add as many as you like, then send them to Claude together.</p>
      </DialogContent>
    </Dialog>
  );
}

/** The fixes waiting to go: one tap sends them all to Claude. */
export function FixTray({
  count,
  sending,
  onSend,
  onClear,
}: {
  count: number;
  sending: boolean;
  onSend: () => void;
  onClear: () => void;
}) {
  if (!count) return null;
  return (
    <div className="sticky bottom-2 z-10 flex items-center justify-between gap-2 rounded-xl border border-primary/50 bg-background/95 p-2 pl-3 shadow-lg backdrop-blur">
      <span className="text-sm font-medium">
        {count} fix{count === 1 ? "" : "es"} ready
      </span>
      <span className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={onClear} aria-label="Clear the fixes">
          <X className="h-4 w-4" aria-hidden />
        </Button>
        <Button size="sm" className="gap-1.5" disabled={sending} onClick={onSend}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          Send fixes
        </Button>
      </span>
    </div>
  );
}
