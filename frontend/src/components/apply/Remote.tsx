import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Camera, Check, CheckCircle2, Copy, Download, Hand, Loader2, Monitor, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Photo } from "@/components/apply/Pages";
import { useHelpDone, useMarkSent, useNotSent, usePeek, usePostMessage } from "@/hooks/useApply";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CARRY_ON_LINE, type ApplyRun, HELP_TITLES } from "@/lib/apply";

/** Save the run's résumé to the computer, to attach it by hand (spec 026). */
function DownloadResume({ file }: { file: { id: string; filename: string } }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const save = async () => {
    setState("busy");
    try {
      const blob = await api.getBlob(`/v1/ai/resumes/${file.id}/file`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  return (
    <div className="space-y-1">
      <Button variant="outline" className="gap-1.5" disabled={state === "busy"} onClick={save}>
        {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
        Download your résumé for this job
      </Button>
      <p className="text-xs text-muted-foreground">{file.filename}</p>
      {state === "failed" && <p className="text-xs text-destructive">Couldn't download it. Try again.</p>}
    </div>
  );
}

// The application page as a remote control (spec 023): answer Claude, talk to
// it, see the screen, know when it stopped, and be sure it was sent, from the
// phone as well as the computer.

const time = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Copy a line, with a short "Copied". */
function CopyLine({ line }: { line: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the line is on screen to copy by hand.
    }
  };
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <code className="flex-1 rounded-md border bg-background px-3 py-2 text-sm">{line}</code>
      <Button variant="secondary" className="gap-1.5" onClick={copy}>
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** The newest "screen now" photo, with when it was taken. With `since`
 * (server time), an older photo is not shown as if it were this screen. */
function LatestLook({ run, since }: { run: ApplyRun; since?: string }) {
  const latest = run.peeks?.[0];
  const stale = !!since && (!latest || new Date(latest.at).getTime() < new Date(since).getTime());
  if (stale) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Taking a photo of this screen…
      </p>
    );
  }
  if (!latest) return null;
  return (
    <figure className="space-y-1">
      <Photo id={latest.id} alt="The application's screen" className="max-h-96 w-full rounded border object-contain" />
      <figcaption className="text-xs text-muted-foreground">The screen at {time(latest.at)}</figcaption>
    </figure>
  );
}

/** Ask Job Catcher for the screen now; says so until the new photo is in. */
function ScreenButton({ run, label = "Show me the screen" }: { run: ApplyRun; label?: string }) {
  const peek = usePeek();
  // What was newest when asked, and when (by this phone's own clock only).
  const [asked, setAsked] = useState<{ newest: string | null; at: number } | null>(null);
  const newest = run.peeks?.[0]?.id ?? null;
  const arrived = asked !== null && newest !== asked.newest;
  const waiting = asked !== null && !arrived && Date.now() - asked.at < 30_000;
  const late = asked !== null && !arrived && Date.now() - asked.at >= 30_000;
  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={peek.isPending || waiting}
        onClick={() => {
          const before = newest;
          peek.mutate(run.id, { onSuccess: () => setAsked({ newest: before, at: Date.now() }) });
        }}
      >
        {waiting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Camera className="h-3.5 w-3.5" aria-hidden />}
        {waiting ? "Asking Job Catcher…" : label}
      </Button>
      {late && (
        <p className="text-xs text-muted-foreground">
          No photo yet: the application's tab may not be showing on the computer, or Job Catcher needs updating.
        </p>
      )}
      {peek.isError && <p className="text-xs text-muted-foreground">{(peek.error as Error).message}</p>}
    </div>
  );
}

/** Claude needs you: its question, the screen, quick answers, or your own words. */
export function HelpCard({ run }: { run: ApplyRun }) {
  const done = useHelpDone();
  const [text, setText] = useState("");
  const help = run.help;
  if (run.status !== "needs_you" || !help || help.done_at) return null;
  const atComputer =
    help.kind === "captcha" || help.kind === "sign_in" || help.kind === "sign_up" || help.kind === "file";
  const send = (reply?: string) => done.mutate({ runId: run.id, reply });
  return (
    <section className="space-y-3 rounded-lg border border-primary/50 bg-primary/5 p-4">
      <h2 className="text-base font-semibold">{HELP_TITLES[help.kind] ?? "Claude needs you"}</h2>
      <p className="flex gap-2 text-sm">
        <Hand className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span>{help.what}</span>
      </p>
      {atComputer && (
        <p className="flex gap-2 rounded-md bg-muted px-3 py-2 text-sm">
          <Monitor className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          This one needs you at the computer, in the application's tab. Then press Done, keep going here.
        </p>
      )}
      {(help.kind === "sign_up" || help.kind === "sign_in") && (
        <p className="text-xs text-muted-foreground">
          Make or type the password yourself: Chrome offers a strong one and saves it for you. Job Enhancer never sees
          or stores your passwords.
        </p>
      )}
      {help.kind === "file" && run.resume_file && <DownloadResume file={run.resume_file} />}
      <LatestLook run={run} since={help.peek_request ? help.at : undefined} />
      <ScreenButton run={run} label="Show me the screen again" />
      {!!help.choices?.length && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick answers">
          {help.choices.map((c) => (
            <Button
              key={c}
              variant="secondary"
              className="h-auto min-h-9 whitespace-normal text-left"
              disabled={done.isPending}
              onClick={() => send(c)}
            >
              {c}
            </Button>
          ))}
        </div>
      )}
      {!atComputer && (
        <div className="space-y-2">
          <Textarea
            aria-label="Your answer for Claude"
            placeholder={help.choices?.length ? "Or type your own answer" : "Type your answer"}
            value={text}
            rows={2}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
          />
          <Button className="gap-1.5" disabled={!text.trim() || done.isPending} onClick={() => send(text.trim())}>
            <Send className="h-4 w-4" aria-hidden /> Send to Claude
          </Button>
        </div>
      )}
      <Button
        variant={atComputer ? "default" : "ghost"}
        disabled={done.isPending}
        onClick={() => send(text.trim() || undefined)}
      >
        Done, keep going
      </Button>
      {done.isError && <p className="text-sm text-destructive">{(done.error as Error).message}</p>}
    </section>
  );
}

/** Talk to Claude: its updates and what you wrote, with a box to write more. */
export function Conversation({ run, open }: { run: ApplyRun; open: boolean }) {
  const post = usePostMessage();
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const messages = run.messages ?? [];
  // The newest message in view, inside the box only (the page never jumps).
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages.length]);
  if (!open && !messages.length) return null;
  const send = () =>
    post.mutate({ runId: run.id, text: text.trim() }, { onSuccess: () => setText("") });
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">Talk to Claude</h2>
      {messages.length ? (
        <ol ref={list} className="max-h-80 space-y-2 overflow-y-auto" aria-live="polite">
          {messages.map((m) => (
            <li key={m.id} className={cn("flex", m.by === "you" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  m.by === "you" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {m.fix && (
                  <p className="truncate text-xs text-primary-foreground/80">{m.fix.box_on_page}</p>
                )}
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p className={cn("mt-0.5 text-[11px]", m.by === "you" ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  {m.by === "you" ? "You" : "Claude"} · {time(m.at)}
                  {m.by === "you" && (m.read ? " · Read by Claude" : " · Waiting for Claude")}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">Claude's updates show here. Anything you write reaches it on its next step.</p>
      )}
      {open && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Textarea
            aria-label="Message Claude"
            placeholder="Message Claude (for example: use my Gmail address for this one)"
            value={text}
            rows={2}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            className="flex-1"
          />
          <Button className="gap-1.5" disabled={!text.trim() || post.isPending} onClick={send}>
            <Send className="h-4 w-4" aria-hidden /> Send
          </Button>
        </div>
      )}
      {post.isError && <p className="text-sm text-destructive">{(post.error as Error).message}</p>}
    </section>
  );
}

/** See the application's screen as it is now. */
export function ScreenNow({ run, open }: { run: ApplyRun; open: boolean }) {
  // Nothing to see before Claude is on the application.
  if (!open || run.ask_if_sent || ["waiting", "reading", "questions", "writing", "resume_review"].includes(run.status)) return null;
  if (run.status === "needs_you" && !run.help?.done_at) return null;
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">The screen</h2>
      <LatestLook run={run} />
      <ScreenButton run={run} />
    </section>
  );
}

/** Claude went quiet on its turn: say so, and how to get it going again. */
export function Stopped({ run }: { run: ApplyRun }) {
  if (!run.claude_stopped || run.ask_if_sent) return null;
  return (
    <section className="space-y-3 rounded-lg border border-amber-500/50 bg-amber-500/5 p-4" role="status">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden /> Claude seems to have stopped
      </h2>
      <p className="text-sm">
        It hasn't checked in for a few minutes. On your computer, open the Claude side panel (a new chat is fine) and say:
      </p>
      <CopyLine line={CARRY_ON_LINE} />
      <p className="text-xs text-muted-foreground">It picks up right where it was. Your answers and messages are kept.</p>
    </section>
  );
}

/** Submit was pressed but nothing confirmed it: did it go through? */
export function DidItGo({ run }: { run: ApplyRun }) {
  const sent = useMarkSent();
  const notSent = useNotSent();
  if (!run.ask_if_sent) return null;
  return (
    <section className="space-y-3 rounded-lg border border-primary/50 bg-primary/5 p-4">
      <h2 className="text-base font-semibold">Did it go through?</h2>
      <p className="text-sm">
        Submit was pressed, but no "thank you for applying" page was seen. Check the screen (or the email from the
        company), then say.
      </p>
      <LatestLook run={run} />
      <ScreenButton run={run} />
      <div className="flex flex-wrap gap-2">
        <Button className="gap-1.5" disabled={sent.isPending} onClick={() => sent.mutate(run.id)}>
          <CheckCircle2 className="h-4 w-4" aria-hidden /> It was sent
        </Button>
        <Button variant="outline" disabled={notSent.isPending} onClick={() => notSent.mutate(run.id)}>
          {run.status === "submitting" ? "It wasn't: Claude fixes it and tries once more" : "It wasn't"}
        </Button>
      </div>
      {(sent.isError || notSent.isError) && (
        <p className="text-sm text-destructive">{((sent.error || notSent.error) as Error).message}</p>
      )}
    </section>
  );
}

/** Is Job Catcher ready on the computer? The first runs failed on an old one. */
export function Readiness({ run, open }: { run: ApplyRun; open: boolean }) {
  const jc = run.job_catcher;
  if (!open || !jc) return null;
  if (jc.ready) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> Job Catcher {jc.version} is ready on your
        computer
      </p>
    );
  }
  if (jc.new_enough) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden /> Job Catcher {jc.version} hasn't checked in
        lately: open Chrome on your computer.
      </p>
    );
  }
  const old = jc.version ? `You have Job Catcher ${jc.version}; this needs ${jc.needs} or newer.` : "Job Catcher hasn't been seen on your computer.";
  return (
    <section className="space-y-1 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-sm" role="status">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden /> Update Job Catcher for photos and filling
      </p>
      <p>
        {old} Without it, Claude can't take photos of the pages or fill what Job Catcher knows.{" "}
        <Link className="underline" to="/job-catcher">
          How to update
        </Link>
      </p>
    </section>
  );
}

/** "Sent, confirmed" with what Job Catcher saw, or plain "Sent". */
export function SentCard({ run }: { run: ApplyRun }) {
  if (run.status !== "sent") return null;
  const seen = run.review?.confirmed;
  return (
    <section className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> {seen ? "Sent, confirmed" : "Sent"}
      </h2>
      {seen && <p className="text-sm">Job Catcher saw: “{seen.words}”</p>}
      <LatestLook run={run} />
      <p className="text-sm">Your job is in Applied. The photos stay here for 30 days; the answers stay with the job.</p>
    </section>
  );
}

export { CopyLine };
