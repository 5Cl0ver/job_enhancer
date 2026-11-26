import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Pencil, Radio, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useLiveFix } from "@/hooks/useApply";
import { cn } from "@/lib/utils";
import type { ApplyRun } from "@/lib/apply";

type Box = { q: string; a: string; by?: "job_catcher" };
/** What the user sent about a box, and what was in it then. */
type Sent = { a: string; to?: string; ask?: string };

/**
 * Tap a box while Claude fills (spec 030): change it, or ask Claude about
 * it. It goes to Claude at once; Claude changes it on the page.
 */
export function LiveFixSheet({
  runId,
  box,
  onSent,
  onClose,
}: {
  runId: string;
  box: Box;
  onSent: (sent: Sent) => void;
  onClose: () => void;
}) {
  const fix = useLiveFix();
  const [mode, setMode] = useState<"to" | "ask">("to");
  const [text, setText] = useState("");
  const words = text.trim();
  const send = () => {
    const what = mode === "to" ? { to: words } : { ask: words };
    fix.mutate(
      { runId, q: box.q, a: box.a, ...what },
      {
        onSuccess: () => {
          onSent({ a: box.a, ...what });
          onClose();
        },
      },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[95dvh] max-w-md overflow-y-auto">
        <DialogTitle className="text-base">{box.q}</DialogTitle>
        <DialogDescription>Now: {box.a.trim() || "empty"}</DialogDescription>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="group" aria-label="What to do">
          {(
            [
              { key: "to", label: "Change it to…", icon: Pencil },
              { key: "ask", label: "Ask Claude", icon: MessageCircle },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={mode === o.key}
              onClick={() => setMode(o.key)}
              className={cn(
                "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md text-sm",
                mode === o.key ? "bg-background font-medium shadow-sm" : "text-muted-foreground",
              )}
            >
              <o.icon className="h-3.5 w-3.5" aria-hidden />
              {o.label}
            </button>
          ))}
        </div>
        {mode === "to" ? (
          <Input
            aria-label="Change it to"
            autoFocus
            value={text}
            maxLength={1900}
            placeholder={box.a || "The new answer"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && words && !fix.isPending && send()}
          />
        ) : (
          <Textarea
            aria-label="Ask Claude"
            autoFocus
            value={text}
            rows={2}
            maxLength={480}
            placeholder="Is this right?"
            onChange={(e) => setText(e.target.value)}
          />
        )}
        <div className="flex gap-2">
          <Button className="gap-1.5" disabled={!words || fix.isPending} onClick={send}>
            {fix.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            Send to Claude
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
        {fix.isError && <p className="text-sm text-destructive">{(fix.error as Error).message}</p>}
        <p className="text-xs text-muted-foreground">Claude gets it right away and changes it on the page.</p>
      </DialogContent>
    </Dialog>
  );
}

const FRESH_MS = 4000;

/**
 * "Filling now" (spec 026): every box on the page Claude is filling and
 * what's in it, as Job Catcher reads it every few seconds. No Claude tokens:
 * Job Catcher reads the page. A box that just changed lights up for a moment.
 * Tap one to change it or ask Claude about it, while Claude fills (spec 030).
 */
export function LiveFill({ run }: { run: ApplyRun }) {
  const filling = run.status === "filling" || run.status === "needs_you";
  const live = filling ? run.live : null;
  const seen = useRef(new Map<string, string>());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [tapped, setTapped] = useState<Box | null>(null);
  const [sent, setSent] = useState<Map<string, Sent>>(new Map());

  useEffect(() => {
    if (!live) return;
    const changed = new Set<string>();
    for (const b of live.boxes) {
      const before = seen.current.get(b.q);
      if (before !== undefined && before !== b.a) changed.add(b.q);
      seen.current.set(b.q, b.a);
    }
    if (changed.size) setFresh(changed);
  }, [live]);

  // Its own timer, so an update with nothing new never leaves a box lit.
  useEffect(() => {
    if (!fresh.size) return;
    const t = setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => clearTimeout(t);
  }, [fresh]);

  if (!filling) return null;
  if (!live) {
    // An older Job Catcher can't read the page for this.
    return run.job_catcher?.new_enough && run.job_catcher.live === false ? (
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        Update Job Catcher to watch the boxes fill here.
      </p>
    ) : null;
  }
  const done = live.boxes.filter((b) => b.a.trim()).length;
  return (
    <section className="space-y-2 rounded-lg border p-4" aria-label="Filling now">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-base font-semibold">
          <Radio className="h-4 w-4 shrink-0 animate-pulse text-primary" aria-hidden />
          <span className="truncate">Filling now{live.title ? `: ${live.title}` : ""}</span>
        </h2>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {done} of {live.boxes.length} filled
        </span>
      </div>
      {live.boxes.length ? (
        <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
          {live.boxes.map((b, i) => {
            // Shown until the box changes (Claude did it, or someone typed).
            const mine = sent.get(b.q);
            const pending = mine && mine.a === b.a ? mine : undefined;
            return (
              <li key={`${i}-${b.q}`}>
                <button
                  type="button"
                  onClick={() => setTapped(b)}
                  aria-label={`${b.q}: ${b.a.trim() || "empty"}. Tap to change it or ask Claude.`}
                  className={cn(
                    "grid min-h-11 w-full gap-0.5 rounded px-2 py-1 text-left transition-colors duration-700 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3",
                    fresh.has(b.q) && "bg-primary/10",
                  )}
                >
                  <span className="truncate text-muted-foreground">{b.q}</span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={cn("truncate", !b.a.trim() && "text-muted-foreground")}>{b.a.trim() || "…"}</span>
                    {b.by === "job_catcher" && (
                      <span className="shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">Job Catcher</span>
                    )}
                  </span>
                  {pending && (
                    <span className="truncate text-xs font-medium text-primary sm:col-span-2">
                      {pending.to ? `→ ${pending.to} (sent to Claude)` : "Asked Claude"}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Looking for boxes on this page…</p>
      )}
      {live.boxes.length > 0 && <p className="text-xs text-muted-foreground">Tap a box to change it or ask Claude.</p>}
      {tapped && (
        <LiveFixSheet
          runId={run.id}
          box={tapped}
          onClose={() => setTapped(null)}
          onSent={(x) => setSent((m) => new Map(m).set(tapped.q, x))}
        />
      )}
    </section>
  );
}
