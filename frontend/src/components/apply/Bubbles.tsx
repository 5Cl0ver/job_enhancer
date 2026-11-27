import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronUp, Loader2, MessageCircle, Pencil, Search, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAddFix, useDidItMyself, useEditFix, useRemoveFix, useSendFixes } from "@/hooks/useApply";
import { cn } from "@/lib/utils";
import {
  type ApplyRun,
  type RowTag,
  type RunFix,
  type SheetRow,
  TAG_LABEL,
  fixFor,
  fixLine,
  fixNotMade,
  isConsentBox,
  isOpenApply,
  normQ,
  sheetOf,
  tagOf,
  waitingFixes,
} from "@/lib/apply";

const TONE: Record<RowTag, string> = {
  changed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  agreement: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  only_you: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  guess: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  empty: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  claude: "bg-primary/10 text-primary",
  profile: "bg-muted text-muted-foreground",
};

/** Who put the answer there, in two or three words. */
export function TagChip({ tag }: { tag: RowTag }) {
  return <span className={cn("shrink-0 whitespace-nowrap rounded px-1.5 text-[11px] leading-5", TONE[tag])}>{TAG_LABEL[tag]}</span>;
}

/** An answer too long for one line: it edits in a growing box (spec 039). */
export function isLongText(text: string): boolean {
  return text.length > 80 || text.includes("\n");
}

/**
 * Fold a long answer to 4 lines. `folds` is true only when the text really
 * runs past them (measured), so a short answer never gets a "Show all".
 */
function useFold(text: string) {
  const ref = useRef<HTMLSpanElement>(null);
  const [all, setAll] = useState(false);
  const [folds, setFolds] = useState(false);
  const long = isLongText(text);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !long || all) return;
    const check = () => setFolds(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, long, all]);
  return { ref, clamp: long && !all, folds: long && folds, all, toggle: () => setAll((a) => !a) };
}

/**
 * One box (spec 033): the question, what's in it, its tag, and where its fix
 * stands ("→ No (waiting)"). Tap it to change it or ask Claude about it. A
 * long answer shows 4 lines and a "Show all" (spec 039).
 */
export function RowButton({
  row,
  fix,
  onTap,
  place,
  fresh = false,
}: {
  row: SheetRow;
  fix?: RunFix;
  onTap?: () => void;
  /** The step's name, where rows of several steps are listed together. */
  place?: string;
  fresh?: boolean;
}) {
  const tag = tagOf(row);
  const empty = !row.a.trim();
  const pending = fix && (fix.status === "waiting" || fix.status === "sent") && fix.to;
  const fold = useFold(row.a);
  const answerId = useId();
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words text-xs text-muted-foreground">
          {place && <span className="font-medium">{place} · </span>}
          {row.q}
        </span>
        {tag && tag !== "empty" && <TagChip tag={tag} />}
      </span>
      <span
        ref={fold.ref}
        id={answerId}
        className={cn(
          "block whitespace-pre-wrap break-words text-sm",
          fold.clamp && "line-clamp-4",
          empty && "italic text-amber-700 dark:text-amber-400",
          pending && "line-through opacity-60",
        )}
      >
        {empty ? "Left empty" : row.a}
      </span>
      {fix && (
        <span
          className={cn(
            "flex items-start gap-1 text-xs font-medium",
            fixNotMade(fix) ? "text-destructive" : fix.status === "done" ? "text-emerald-700 dark:text-emerald-400" : "text-primary",
          )}
        >
          {fix.to ? null : <MessageCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
          <span className="min-w-0 break-words">{fixLine(fix)}</span>
        </span>
      )}
    </>
  );
  const shape = cn(
    "block w-full space-y-0.5 rounded-lg px-3 py-2 text-left transition-colors duration-700",
    fresh && "bg-primary/10",
    fix?.status === "waiting" && "bg-primary/5 ring-1 ring-primary/40",
  );
  const box = !onTap ? (
    <div className={shape}>{body}</div>
  ) : (
    <button
      type="button"
      onClick={onTap}
      className={cn(shape, "min-h-11 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      aria-label={`${row.q}: ${empty ? "left empty" : row.a}. Tap to change it or ask Claude.`}
    >
      {body}
    </button>
  );
  if (!fold.folds) return box;
  // Its own button, beside the row's (a button can't hold another).
  return (
    <div>
      {box}
      <button
        type="button"
        aria-expanded={fold.all}
        aria-controls={answerId}
        aria-label={`${fold.all ? "Show less" : "Show all"} of ${row.q}`}
        onClick={fold.toggle}
        className="min-h-8 px-3 text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        {fold.all ? "Show less" : "Show all"}
      </button>
    </div>
  );
}

/** The box a fix is about: where it is, what's in it, and the form's choices. */
export interface FixTarget {
  step: string;
  stepTitle: string;
  q: string;
  a: string;
  k: number;
  options?: string[];
  free?: boolean;
}

const SEARCH_FROM = 8;
/** The most a change can hold (the server keeps 2,000 characters). */
const MAX_TO = 2000;

/**
 * Change one box, or ask Claude about it (spec 033). A dropdown, radio or
 * checkbox group shows the form's own choices (search when there are many);
 * a text box only when the form takes typed words. Nothing reaches Claude
 * here: the fix waits for its checkpoint.
 */
export function FixSheet({
  target,
  current,
  note,
  busy = false,
  error,
  onSave,
  onRemove,
  onClose,
  notMade,
  onDidIt,
}: {
  target: FixTarget;
  current?: { to?: string | null; ask?: string | null };
  note?: string;
  busy?: boolean;
  error?: string | null;
  onSave: (fix: { to?: string; ask?: string }) => void;
  onRemove?: () => void;
  onClose: () => void;
  /** A fix Claude couldn't or wouldn't make (spec 038): the owner can do it. */
  notMade?: RunFix;
  onDidIt?: () => void;
}) {
  const options = useMemo(() => target.options ?? [], [target.options]);
  const known = (v?: string | null) => !!v && options.some((o) => normQ(o) === normQ(v));
  const now = target.a.trim();
  const [pick, setPick] = useState<string | null>(known(current?.to) ? current!.to! : null);
  // A long typed answer (spec 039) edits in a growing box that starts with
  // what's there now, so a small change is a small edit.
  const [big] = useState(() => !options.length && (isLongText(now) || isLongText(current?.to ?? "")));
  const [other, setOther] = useState(current?.to && !known(current.to) ? current.to : big ? now : "");
  // Grows with its text where the browser can't by itself (no field-sizing):
  // the whole sheet scrolls, never a little box inside it.
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content"))) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [other]);
  const [typing, setTyping] = useState(!options.length || (!!current?.to && !known(current.to)));
  const [ask, setAsk] = useState(current?.ask ?? "");
  const [asking, setAsking] = useState(!!current?.ask);
  const [search, setSearch] = useState("");
  const shown = useMemo(
    () => (search.trim() ? options.filter((o) => o.toLowerCase().includes(search.trim().toLowerCase())) : options),
    [options, search],
  );
  const typed = (typing ? other : pick ?? "").trim();
  // The growing box starts with the answer: unchanged isn't a change.
  const to = big && typing && typed === now ? "" : typed;
  const words = ask.trim();
  const save = () => onSave({ ...(to ? { to } : {}), ...(words ? { ask: words } : {}) });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-md gap-3 overflow-y-auto">
        <DialogTitle className="pr-6 text-base leading-snug">{target.q}</DialogTitle>
        <DialogDescription className="text-xs">{target.stepTitle}</DialogDescription>

        {/* What's in the box now, in full and readable (spec 039). */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Now</p>
          <p
            className={cn(
              "whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-3 py-2 text-sm",
              !now && "italic text-muted-foreground",
            )}
          >
            {now || "Left empty"}
          </p>
        </div>

        {/* Claude couldn't or wouldn't make it (spec 038): do it yourself. */}
        {notMade && onDidIt && (
          <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm">{fixLine(notMade)}</p>
            <Button variant="outline" className="w-full gap-1.5" disabled={busy} onClick={onDidIt}>
              <Check className="h-4 w-4" aria-hidden /> I did it myself
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Change it to</p>
          {options.length > 0 && (
            <>
              {options.length > SEARCH_FROM && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    aria-label="Search the choices"
                    placeholder={`Search ${options.length} choices`}
                    className="pl-8"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              )}
              <div role="radiogroup" aria-label="Choices" className="max-h-64 space-y-1 overflow-y-auto">
                {shown.map((o) => {
                  const on = !typing && pick === o;
                  const isNow = normQ(o) === normQ(now);
                  return (
                    <button
                      key={o}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setTyping(false);
                        setPick(o);
                      }}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        on ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted/60",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                          on && "border-primary bg-primary text-primary-foreground",
                        )}
                        aria-hidden
                      >
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1 break-words">{o}</span>
                      {isNow && <span className="shrink-0 text-[11px] text-muted-foreground">Now</span>}
                    </button>
                  );
                })}
                {!shown.length && <p className="px-1 text-sm text-muted-foreground">No choice matches.</p>}
              </div>
              {target.free && !typing && (
                <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setTyping(true)}>
                  Something else
                </button>
              )}
            </>
          )}
          {typing &&
            (big ? (
              <Textarea
                ref={box}
                aria-label="Change it to"
                value={other}
                rows={4}
                maxLength={MAX_TO}
                placeholder="The new answer"
                onChange={(e) => setOther(e.target.value)}
              />
            ) : (
              <Input
                aria-label="Change it to"
                autoFocus={!options.length}
                value={other}
                maxLength={1900}
                placeholder={now || "The new answer"}
                onChange={(e) => setOther(e.target.value)}
              />
            ))}
          {typing && big && other.length >= MAX_TO - 100 && (
            // The box stops taking letters at the limit: say so.
            <p className="text-xs text-muted-foreground">2,000 characters max</p>
          )}
          {isConsentBox(target) && (
            <p className="text-xs text-muted-foreground">
              Claude never ticks optional boxes (texts, marketing) by itself. Ask here and it will.
            </p>
          )}
        </div>

        {asking ? (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Ask Claude about it</p>
            <Textarea
              aria-label="Ask Claude about it"
              value={ask}
              rows={2}
              maxLength={480}
              placeholder="Is this right?"
              onChange={(e) => setAsk(e.target.value)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 self-start text-sm text-primary underline-offset-2 hover:underline"
            onClick={() => setAsking(true)}
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden /> Ask Claude about it
          </button>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {current && onRemove && (
            <Button variant="ghost" className="text-destructive" disabled={busy} onClick={onRemove}>
              Remove fix
            </Button>
          )}
          <Button className="gap-1.5 sm:ml-auto" disabled={(!to && !words) || busy} onClick={save}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {current ? "Update fix" : "Add fix"}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </DialogContent>
    </Dialog>
  );
}

/** When a fix for this box reaches Claude, in plain words. */
function whenItGoes(run: ApplyRun, step: string): string {
  if (run.status === "review") return "Add as many as you like, then press Send fixes.";
  if (run.mode !== "keep") {
    if (run.paused_step === step) return "It goes to Claude when you press Continue.";
    // The step being filled now pauses when it's done: Continue sends it.
    const s = sheetOf(run).steps.find((x) => x.key === step);
    if (s && !s.done && !s.checked) return "It goes to Claude when you press Continue after this step.";
  }
  return "It waits, and goes to Claude when it finishes the last step.";
}

/**
 * Tap a box, change it: the sheet, wired to the run's waiting fixes (add,
 * update, remove). `open` is undefined when the run can't take fixes now.
 */
export function useFixer(run: ApplyRun) {
  const [target, setTarget] = useState<FixTarget | null>(null);
  const add = useAddFix();
  const edit = useEditFix();
  const remove = useRemoveFix();
  const didIt = useDidItMyself();
  const can =
    isOpenApply(run) && run.status !== "submitting" && !(run.status === "review" && run.review?.decision);
  const found = target ? fixFor(run.fixes, target.step, target.q, target.k) : undefined;
  const waiting = found?.status === "waiting" ? found : undefined;
  const notMade = fixNotMade(found) ? found : undefined;
  const close = () => setTarget(null);
  const failed = [add, edit, remove, didIt].find((m) => m.isError)?.error as Error | undefined;
  const sheet = target && (
    <FixSheet
      key={`${target.step}|${target.q}|${target.k}`}
      target={target}
      current={waiting}
      note={whenItGoes(run, target.step)}
      busy={add.isPending || edit.isPending || remove.isPending || didIt.isPending}
      error={failed?.message ?? null}
      onClose={close}
      onSave={(v) =>
        waiting
          ? edit.mutate({ runId: run.id, fixId: waiting.id, ...v }, { onSuccess: close })
          : add.mutate({ runId: run.id, step: target.step, q: target.q, k: target.k, ...v }, { onSuccess: close })
      }
      onRemove={waiting ? () => remove.mutate({ runId: run.id, fixId: waiting.id }, { onSuccess: close }) : undefined}
      notMade={notMade}
      onDidIt={notMade && (() => didIt.mutate({ runId: run.id, fixId: notMade.id }, { onSuccess: close }))}
    />
  );
  return { open: can ? setTarget : undefined, sheet };
}

const MAX_WAITING = 30;

/**
 * The fixes waiting on the run (spec 033): a calm bar at the bottom, open it
 * to edit or remove one. While Claude fills they wait for their checkpoint
 * (a small Send now for the rare urgent case); at the review, Send fixes.
 */
export function FixTray({ run, review = false }: { run: ApplyRun; review?: boolean }) {
  const [open, setOpen] = useState(false);
  const send = useSendFixes();
  const fixer = useFixer(run);
  const waiting = waitingFixes(run);
  if (!waiting.length || !fixer.open) return fixer.sheet || null;
  const sheet = sheetOf(run);
  const titleOf = (key: string) => sheet.steps.find((s) => s.key === key)?.title ?? "";
  const edit = (f: RunFix) => {
    const step = sheet.steps.find((s) => s.key === f.step);
    const same = step?.rows.filter((r) => normQ(r.q) === normQ(f.q)) ?? [];
    const row = same[(f.k || 1) - 1];
    fixer.open?.({ step: f.step, stepTitle: titleOf(f.step), q: f.q, a: row?.a ?? f.now, k: f.k || 1, options: row?.options, free: row?.free });
  };
  const n = waiting.length;
  const label = `${n} fix${n === 1 ? "" : "es"} waiting`;
  const when = review
    ? "Claude makes them together, then asks you again."
    : run.mode === "keep"
      ? "They go to Claude when it finishes the last step."
      : "Each goes to Claude when you press Continue after its step, or at the end.";
  return (
    <div className="sticky bottom-2 z-10 rounded-xl border border-primary/40 bg-background/95 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2 p-2 pl-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-medium"
        >
          <ChevronUp className={cn("h-4 w-4 shrink-0 transition-transform", !open && "rotate-180")} aria-hidden />
          <span className="truncate">{label}</span>
        </button>
        {review ? (
          <Button size="sm" className="gap-1.5" disabled={send.isPending} onClick={() => send.mutate(run.id)}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            Send fixes
          </Button>
        ) : (
          <button
            type="button"
            disabled={send.isPending}
            onClick={() => {
              if (window.confirm("Send these to Claude now? It may stop what it's doing to make them.")) send.mutate(run.id);
            }}
            className="shrink-0 px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Send now
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2 border-t p-2">
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {waiting.map((f) => (
              <li key={f.id} className="flex items-start gap-1 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => edit(f)} aria-label={`Edit the fix for ${f.q}`}>
                  <span className="block truncate text-xs text-muted-foreground">
                    {titleOf(f.step)} · {f.q}
                  </span>
                  <span className="block break-words text-sm">{f.to ? `→ ${f.to}` : `Ask: ${f.ask}`}</span>
                </button>
                <Pencil className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <RemoveFix run={run} fix={f} />
              </li>
            ))}
          </ul>
          <p className="px-2 text-xs text-muted-foreground">
            {n >= MAX_WAITING ? `${MAX_WAITING} fixes, the most at once. Send them to add more. ` : ""}
            {when}
          </p>
        </div>
      )}
      {send.isError && <p className="px-3 pb-2 text-xs text-destructive">{(send.error as Error).message}</p>}
      {fixer.sheet}
    </div>
  );
}

function RemoveFix({ run, fix }: { run: ApplyRun; fix: RunFix }) {
  const remove = useRemoveFix();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-8 shrink-0 p-0"
      disabled={remove.isPending}
      aria-label={`Remove the fix for ${fix.q}`}
      onClick={() => remove.mutate({ runId: run.id, fixId: fix.id })}
    >
      <X className="h-4 w-4" aria-hidden />
    </Button>
  );
}
