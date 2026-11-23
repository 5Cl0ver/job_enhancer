// "This page" on any page with a form: Autofill, with one status line that
// always says what's happening (spec 016), then review EVERYTHING it did —
// each field with where its answer came from, Fix (with the page's real
// options), Show, Undo — the questions left for you, Undo all, and Remember
// what you typed. Every frame of the tab is covered (spec 015, Story 2).
import * as React from "react";
import {
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  LocateFixed,
  PenLine,
  Pencil,
  Save,
  Undo2,
  Zap,
} from "lucide-react";
import { Alert, Badge, Button, Card, Input, Muted, SectionTitle, Select, Switch } from "@/ui";
import { cn } from "@/lib/utils";
import { send } from "@/lib/chrome";
import type { SavedJob } from "@/lib/context";
import { usePanel, type FillEntry, type FillNeed, type FillStatus, type FillSuggestion, type Presence } from "@/lib/store";

const SOURCE: Record<string, { label: string; tone: string }> = {
  profile: { label: "Profile", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  learned: { label: "Remembered", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  ai: { label: "AI · check", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
};

const WHY: Record<string, string> = {
  sensitive: "Only you answer this",
  essay: "Written answer: yours to write",
  no_data: "Not in your profile yet",
  no_option: "None of its choices matched",
  rejected: "The page didn't take it",
  unknown: "New question",
  other_person: "About someone else",
};

export function Apply({
  site,
  isApplication,
  autoTracked,
  match,
  onWrite,
}: {
  site: string;
  isApplication: boolean;
  autoTracked: boolean;
  match: SavedJob | null;
  onWrite: (id: string) => void;
}) {
  const { tab, reloadSaved, staged, fill } = usePanel();
  const [busy, setBusy] = React.useState(false);
  const [marking, setMarking] = React.useState(false);
  const [showFilled, setShowFilled] = React.useState(false);

  const { entries, needYou, suggestions } = fill;
  const toCheck = entries.filter((e) => e.source === "ai" && !e.fixed);
  const checkCount = toCheck.length + suggestions.length;
  const sure = entries.filter((e) => !(e.source === "ai" && !e.fixed));

  // The background fills every frame that holds a form and keeps the status
  // line up to date while it works; the result lands there too.
  async function autofill() {
    if (!tab.id) return;
    setBusy(true);
    await send({ type: "pressAutofill", tabId: tab.id });
    setBusy(false);
  }
  const filling = busy || fill.presence?.status?.phase === "filling";

  async function undoAll() {
    if (!tab.id) return;
    for (const frameId of new Set(entries.map((e) => e.frameId))) {
      await send({ type: "fillAction", tabId: tab.id, frameId, action: "undo" });
    }
  }

  async function markApplied() {
    if (!match) return;
    setMarking(true);
    await send({ type: "markApplied", job: { title: match.title, company: match.company } });
    await reloadSaved();
    setMarking(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            {isApplication ? `Applying on ${site}` : `A form on ${site}`}
          </span>
          <SectionTitle>{match ? match.title : isApplication ? "Application in progress" : "Fill it from your profile"}</SectionTitle>
          {isApplication && <Muted>{match ? match.company : "Save the job below so it's tracked."}</Muted>}
        </div>
        <Button onClick={autofill} busy={filling} disabled={filling} className="w-full">
          {!filling && <Zap />}
          {filling ? "Filling…" : entries.length ? "Fill again" : "Autofill this page"}
        </Button>
        <StatusLine presence={fill.presence} busy={busy} filledNow={entries.length} needNow={needYou.length} />
        <ShortcutHint />
        {staged && !entries.length && (
          <Muted>
            Uploads your tailored résumé <b className="break-all text-foreground">{staged}</b>.
          </Muted>
        )}
        {!filling && entries.length + needYou.length > 0 && (
          <p className="text-xs" aria-live="polite">
            <b className="text-emerald-700 dark:text-emerald-300">{entries.length} filled</b>
            {checkCount > 0 && <span className="text-violet-700 dark:text-violet-300"> · {checkCount} to check</span>}
            {needYou.length > 0 && <span className="text-amber-700 dark:text-amber-300"> · {needYou.length} for you</span>}
            <span className="text-muted-foreground"> · nothing was submitted</span>
          </p>
        )}
        {entries.length > 0 && (
          <label className="flex cursor-pointer items-center justify-between gap-3 text-xs">
            <span>
              <b className="font-medium">Keep filling this application</b>
              <span className="block text-muted-foreground">Each next step fills as it appears.</span>
            </span>
            <Switch
              checked={fill.keep}
              label="Keep filling this application"
              onCheckedChange={(on) => tab.id && send({ type: "setKeepFilling", tabId: tab.id, on })}
            />
          </label>
        )}
      </Card>

      <Learned />

      {needYou.length > 0 && (
        <Section title="Needs you" count={needYou.length} tone="text-amber-700 dark:text-amber-300">
          {needYou.map((n) => (
            <NeedRow key={`${n.frameId}:${n.id}`} need={n} />
          ))}
        </Section>
      )}

      {checkCount > 0 && (
        <Section title="Check these" count={checkCount} tone="text-violet-700 dark:text-violet-300">
          {suggestions.map((g) => (
            <SuggestionRow key={`${g.frameId}:${g.id}`} suggestion={g} />
          ))}
          {toCheck.map((e) => (
            <EntryRow key={`${e.frameId}:${e.id}`} entry={e} />
          ))}
        </Section>
      )}

      {sure.length > 0 && (
        <Card className="p-0">
          <button
            type="button"
            aria-expanded={showFilled}
            onClick={() => setShowFilled((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
          >
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <span className="flex-1 font-medium">
              {sure.length} filled from your profile and answers
            </span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", showFilled && "rotate-180")} aria-hidden />
          </button>
          {showFilled && (
            <ul className="divide-y border-t">
              {sure.map((e) => (
                <EntryRow key={`${e.frameId}:${e.id}`} entry={e} />
              ))}
            </ul>
          )}
        </Card>
      )}

      {(entries.length > 0 || needYou.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {entries.some((e) => e.can_undo) && (
            <Button variant="outline" size="sm" onClick={undoAll}>
              <Undo2 />
              Undo all
            </Button>
          )}
          <Remember />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {match?.applied ? (
          <Badge variant="success">
            <CheckCircle2 aria-hidden /> Tracked as applied
          </Badge>
        ) : match ? (
          <Button variant="outline" size="sm" onClick={markApplied} busy={marking}>
            {!marking && <ClipboardCheck />}I submitted it: mark applied
          </Button>
        ) : null}
        {match?.job_listing_id && (
          <Button variant="ghost" size="sm" onClick={() => onWrite(match.job_listing_id)}>
            <PenLine />
            Write for this job
          </Button>
        )}
      </div>
      <Muted>
        {autoTracked
          ? "Autofill never submits. When you submit, the job moves to Applied by itself."
          : "Autofill never submits. After you submit, press Mark applied."}
      </Muted>
    </div>
  );
}

const PROBLEM: Record<string, string> = {
  signed_out: "Sign in to Job Enhancer first (top of this panel), then press Autofill.",
  asleep: "Couldn't reach Job Enhancer (it may be waking up). Try again in a moment.",
  refresh: "Couldn't reach the page. Refresh it once, then press Autofill again.",
  slow: "This is taking too long. Press Autofill to try again.",
};
const STUCK_MS = 20_000;

/**
 * One line that always says what's happening: looking, ready, filling N of
 * M, done, or what went wrong — never silence, never a spinner forever.
 */
function StatusLine({
  presence,
  busy,
  filledNow,
  needNow,
}: {
  presence: Presence | null;
  busy: boolean;
  filledNow: number;
  needNow: number;
}) {
  const status: FillStatus | null = presence?.status || null;
  const [now, setNow] = React.useState(Date.now());
  const working = busy || status?.phase === "filling";
  React.useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [working]);

  let tone: "info" | "ok" | "warn" = "info";
  let text: string;
  if (status?.phase === "filling" && now - status.at > STUCK_MS) {
    tone = "warn";
    text = PROBLEM.slow;
  } else if (working) {
    const n = status?.total ? ` ${Math.min(status.done || 0, status.total)} of ${status.total}` : "";
    text = status?.note && !n ? status.note : `Filling…${n}`;
  } else if (status?.phase === "problem") {
    tone = "warn";
    text = PROBLEM[status.problem || "refresh"] || PROBLEM.refresh;
  } else if (status?.phase === "done") {
    if (!filledNow && !(status.filled || 0)) {
      tone = "warn";
      text = needNow ? "Nothing here matched your profile. The questions are listed below for you." : "Nothing here matched your profile.";
    } else {
      tone = "ok";
      text = "Done. Check the page, then submit it yourself.";
    }
  } else if (!presence) {
    text = "Looking at this page…";
  } else if (presence.form) {
    tone = "ok";
    text = "Form found: ready to fill.";
  } else {
    text = "No form found yet. Press Autofill to try anyway.";
  }
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="fill-status"
      className={cn(
        "flex items-center gap-2 text-xs",
        tone === "ok" && "text-emerald-700 dark:text-emerald-300",
        tone === "warn" && "text-amber-700 dark:text-amber-300",
        tone === "info" && "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-primary",
          working && "animate-pulse",
        )}
      />
      {text}
    </p>
  );
}

/** The keyboard shortcut Chrome really gave Autofill (another extension can take ours). */
function ShortcutHint() {
  const [key, setKey] = React.useState<string | null>(null);
  React.useEffect(() => {
    chrome.commands
      ?.getAll?.()
      .then((all) => setKey(all.find((c) => c.name === "autofill")?.shortcut || ""))
      .catch(() => setKey(null));
  }, []);
  if (key == null) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      {key ? (
        <>
          Shortcut: <kbd className="rounded border px-1 font-mono">{key}</kbd>
        </>
      ) : (
        <button
          type="button"
          className="cursor-pointer underline underline-offset-2 hover:text-foreground"
          onClick={() => chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}
        >
          Set a keyboard shortcut for Autofill
        </button>
      )}
    </p>
  );
}

function Section({ title, count, tone, children }: { title: string; count: number; tone: string; children: React.ReactNode }) {
  return (
    <Card className="p-0">
      <h3 className={cn("px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide", tone)}>
        {title} ({count})
      </h3>
      <ul className="divide-y">{children}</ul>
    </Card>
  );
}

function useAction() {
  const { tab } = usePanel();
  return React.useCallback(
    (frameId: number, action: "fix" | "undo" | "show" | "use", id: string, value?: string) =>
      tab.id ? send({ type: "fillAction", tabId: tab.id, frameId, action, id, value }) : Promise.resolve(null),
    [tab.id],
  );
}

function Editor({
  options,
  initial,
  label,
  onSave,
  onCancel,
}: {
  options: string[];
  initial: string;
  label: string;
  onSave: (v: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(options.length ? options.find((o) => o === initial) || "" : initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError(false);
    const ok = await onSave(value);
    setBusy(false);
    if (!ok) setError(true);
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-1.5 pt-2">
      <div className="flex gap-1.5">
        {options.length ? (
          <Select aria-label={label} autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="flex-1">
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </Select>
        ) : (
          <Input aria-label={label} autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="flex-1" />
        )}
        <Button type="submit" size="sm" busy={busy} disabled={!value.trim()}>
          Apply
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">The page didn't take that. Pick another or fill it on the page.</p>}
    </form>
  );
}

function EntryRow({ entry }: { entry: FillEntry }) {
  const act = useAction();
  const [editing, setEditing] = React.useState(false);
  const src = entry.fixed ? { label: "You", tone: "bg-muted text-foreground" } : SOURCE[entry.source] || SOURCE.profile;
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{entry.label}</p>
          <p className="truncate font-medium">{entry.value || "—"}</p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium", src.tone)}>{src.label}</span>
        <Button variant="ghost" size="icon-sm" aria-label={`Show ${entry.label} on the page`} title="Show on the page" onClick={() => act(entry.frameId, "show", entry.id)}>
          <LocateFixed />
        </Button>
        {entry.kind !== "file" && (
          <Button variant="ghost" size="icon-sm" aria-label={`Fix ${entry.label}`} title="Fix" onClick={() => setEditing((v) => !v)}>
            <Pencil />
          </Button>
        )}
        {entry.can_undo && (
          <Button variant="ghost" size="icon-sm" aria-label={`Undo ${entry.label}`} title="Undo" onClick={() => act(entry.frameId, "undo", entry.id)}>
            <Undo2 />
          </Button>
        )}
      </div>
      {editing && (
        <Editor
          label={`New value for ${entry.label}`}
          options={entry.options}
          initial={entry.value}
          onCancel={() => setEditing(false)}
          onSave={async (v) => {
            const r = await act(entry.frameId, "fix", entry.id, v);
            if (r?.ok) setEditing(false);
            return !!r?.ok;
          }}
        />
      )}
    </li>
  );
}

function NeedRow({ need }: { need: FillNeed }) {
  const act = useAction();
  const [editing, setEditing] = React.useState(false);
  const canAnswer = need.reason !== "sensitive" && need.reason !== "essay" && need.kind !== "file";
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{need.label}</p>
          <p className="truncate text-xs text-muted-foreground">{need.kind === "file" ? "Upload a file" : WHY[need.reason] || "Needs you"}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={`Show ${need.label} on the page`} title="Show on the page" onClick={() => act(need.frameId, "show", need.id)}>
          <LocateFixed />
        </Button>
        {canAnswer && (
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            Answer
          </Button>
        )}
      </div>
      {editing && (
        <Editor
          label={`Answer for ${need.label}`}
          options={need.options}
          initial=""
          onCancel={() => setEditing(false)}
          onSave={async (v) => {
            const r = await act(need.frameId, "fix", need.id, v);
            if (r?.ok) setEditing(false);
            return !!r?.ok;
          }}
        />
      )}
    </li>
  );
}

/** "Remember what I typed": the answers you gave, kept for next time. */
function Remember() {
  const { tab, fill } = usePanel();
  const [rows, setRows] = React.useState<{ question_key: string; question_text: string; answer: string; keep: boolean }[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState("");

  async function look() {
    if (!tab.id) return;
    setBusy(true);
    setNote("");
    const found: typeof rows = [];
    for (const frameId of fill.frameIds) {
      const r = await send({ type: "fillAction", tabId: tab.id, frameId, action: "typed" });
      for (const a of r?.answers || []) if (!found.some((f) => f.question_key === a.question_key)) found.push({ ...a, keep: true });
    }
    setBusy(false);
    if (!found.length) setNote("Nothing new to remember yet: answer a question on the page first.");
    setRows(found.length ? found : null);
  }

  async function save() {
    const answers = (rows || []).filter((r) => r.keep && r.answer.trim()).map(({ question_key, question_text, answer }) => ({ question_key, question_text, answer: answer.trim() }));
    if (!answers.length) return setRows(null);
    setBusy(true);
    const r = await send({ type: "saveCustomAnswers", answers });
    setBusy(false);
    setRows(null);
    setNote(r?.ok ? `Remembered ${answers.length}. They fill in next time.` : "Couldn't save them. Try again.");
  }

  return (
    <>
      {!rows && (
        <Button variant="ghost" size="sm" onClick={look} busy={busy}>
          {!busy && <Save />}Remember what I typed
        </Button>
      )}
      {note && <p className="w-full text-xs text-muted-foreground">{note}</p>}
      {rows && (
        <Card className="flex w-full flex-col gap-2">
          <SectionTitle className="text-sm">Remember these answers?</SectionTitle>
          <Muted>Uncheck anything you don't want kept. Edit an answer if needed.</Muted>
          <ul className="flex flex-col gap-2.5">
            {rows.map((r, i) => (
              <li key={r.question_key} className="flex flex-col gap-1">
                <label className="flex cursor-pointer items-start gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                    checked={r.keep}
                    onChange={(e) => setRows((rs) => rs && rs.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))}
                  />
                  {r.question_text}
                </label>
                <Input
                  aria-label={`Answer to ${r.question_text}`}
                  className="ml-6 w-auto"
                  value={r.answer}
                  onChange={(e) => setRows((rs) => rs && rs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
                />
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button onClick={save} busy={busy} className="flex-1">
              Save answers
            </Button>
            <Button variant="ghost" onClick={() => setRows(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

/** An unsure AI answer: shown, never filled until the user taps Use. */
function SuggestionRow({ suggestion }: { suggestion: FillSuggestion }) {
  const act = useAction();
  const [busy, setBusy] = React.useState(false);
  return (
    <li className="flex items-center gap-2 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">{suggestion.label}</p>
        <p className="truncate font-medium">
          <span className="text-muted-foreground">Suggested: </span>
          {suggestion.value}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Show ${suggestion.label} on the page`}
        title="Show on the page"
        onClick={() => act(suggestion.frameId, "show", suggestion.id)}
      >
        <LocateFixed />
      </Button>
      <Button
        variant="outline"
        size="sm"
        busy={busy}
        aria-label={`Use the suggestion for ${suggestion.label}`}
        onClick={async () => {
          setBusy(true);
          await act(suggestion.frameId, "use", suggestion.id);
          setBusy(false);
        }}
      >
        Use
      </Button>
    </li>
  );
}

const PROFILE_LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  phone: "Phone",
  address_line1: "Address",
  address_line2: "Address line 2",
  city: "City",
  state: "State",
  postal_code: "ZIP / postal code",
  country: "Country",
  linkedin_url: "LinkedIn",
  github_url: "GitHub",
  portfolio_url: "Website",
  authorized_to_work: "Authorized to work",
  requires_sponsorship: "Needs sponsorship",
  willing_to_relocate: "Willing to relocate",
  desired_salary: "Desired salary",
  notice_period: "Notice / start",
};
const show = (v: string | number | boolean) => (v === true ? "Yes" : v === false ? "No" : String(v));

/** What the user typed as they moved on: remember it (their press) or not. */
function Learned() {
  const { tab, fill } = usePanel();
  const { answers, profile } = fill.pending;
  const profileKeys = Object.keys(profile);
  const [keepA, setKeepA] = React.useState<Record<string, boolean>>({});
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [keepP, setKeepP] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState<"" | "a" | "p">("");
  const [note, setNote] = React.useState("");
  if (!tab.id || (!answers.length && !profileKeys.length && !note)) return null;

  async function saveAnswers() {
    const chosen = answers
      .filter((x) => keepA[x.question_key] !== false)
      .map((x) => ({ ...x, answer: (edits[x.question_key] ?? x.answer).trim() }))
      .filter((x) => x.answer);
    const dismiss = answers.filter((x) => keepA[x.question_key] === false).map((x) => x.question_key);
    setBusy("a");
    const r = await send({ type: "savePendingAnswers", tabId: tab.id, answers: chosen, dismiss });
    setBusy("");
    setNote(r?.ok ? `Remembered ${chosen.length}. They fill in next time.` : "Couldn't save them. Try again.");
  }

  async function saveProfile() {
    const fields = Object.fromEntries(profileKeys.filter((k) => keepP[k] !== false).map((k) => [k, profile[k]]));
    setBusy("p");
    const r = await send({ type: "savePendingProfile", tabId: tab.id, fields });
    setBusy("");
    setNote(r?.ok ? "Saved to your profile. Every application uses it now." : "Couldn't save your profile. Try again.");
  }

  return (
    <>
      {note && <Alert tone="success">{note}</Alert>}
      {answers.length > 0 && (
        <Card className="flex flex-col gap-2.5">
          <SectionTitle className="text-sm">New answers to remember</SectionTitle>
          <Muted>From what you typed. Uncheck any you don't want kept.</Muted>
          <ul className="flex flex-col gap-2.5">
            {answers.map((x) => (
              <li key={x.question_key} className="flex flex-col gap-1">
                <label className="flex cursor-pointer items-start gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                    checked={keepA[x.question_key] !== false}
                    onChange={(e) => setKeepA((k) => ({ ...k, [x.question_key]: e.target.checked }))}
                  />
                  {x.question_text}
                </label>
                <Input
                  aria-label={`Answer to ${x.question_text}`}
                  className="ml-6 w-auto"
                  value={edits[x.question_key] ?? x.answer}
                  onChange={(e) => setEdits((m) => ({ ...m, [x.question_key]: e.target.value }))}
                />
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button onClick={saveAnswers} busy={busy === "a"} className="flex-1">
              Remember these
            </Button>
            <Button variant="ghost" onClick={() => send({ type: "dismissPending", tabId: tab.id, kind: "answers" })}>
              Not now
            </Button>
          </div>
        </Card>
      )}
      {profileKeys.length > 0 && (
        <Card className="flex flex-col gap-2.5">
          <SectionTitle className="text-sm">Save to my profile?</SectionTitle>
          <Muted>You typed these; your profile doesn't have them yet (or has them differently).</Muted>
          <ul className="flex flex-col gap-1.5">
            {profileKeys.map((k) => (
              <li key={k}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    checked={keepP[k] !== false}
                    onChange={(e) => setKeepP((m) => ({ ...m, [k]: e.target.checked }))}
                  />
                  <span className="text-muted-foreground">{PROFILE_LABELS[k] || k}</span>
                  <b className="min-w-0 truncate font-medium">{show(profile[k])}</b>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button onClick={saveProfile} busy={busy === "p"} className="flex-1">
              Save to my profile
            </Button>
            <Button variant="ghost" onClick={() => send({ type: "dismissPending", tabId: tab.id, kind: "profile" })}>
              Not now
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
