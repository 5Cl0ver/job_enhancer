// "Point at a box" (spec 017): while pointing, the panel says what to do; once
// a box on the page is clicked, it asks "What goes here?" — the profile's
// answers or typed text — fills it, remembers it for that site (in the
// account, so on every computer) and points again for the next box.
import * as React from "react";
import { Check, MousePointerClick, Search, X } from "lucide-react";
import { Alert, Button, Card, Input, Muted, SectionTitle, Select, Switch, Textarea } from "@/ui";
import { send } from "@/lib/chrome";
import { usePanel, type Pick } from "@/lib/store";
import { profileValues } from "../../../src/autofill/classify/profileKeys.js";

/** The profile answers a box can take, in the order people look for them. */
const ANSWERS: [key: string, label: string][] = [
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["full_name", "Full name"],
  ["preferred_name", "Preferred name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["address_line1", "Street address"],
  ["address_line2", "Address line 2"],
  ["city", "City"],
  ["state", "State"],
  ["postal_code", "Zip / postal code"],
  ["country", "Country"],
  ["location", "City, State"],
  ["linkedin_url", "LinkedIn"],
  ["github_url", "GitHub"],
  ["portfolio_url", "Website / portfolio"],
  ["current_title", "Current job title"],
  ["current_company", "Current company"],
  ["school", "School"],
  ["degree", "Degree"],
  ["field_of_study", "Field of study"],
  ["graduation_year", "Graduation year"],
  ["desired_salary", "Desired salary"],
  ["notice_period", "Notice period"],
];

const REFUSED: Record<string, string> = {
  consent: "That's a checkbox or choice only you can tick (an agreement, a yes/no). Job Catcher never ticks those.",
  sensitive: "That asks about you personally (gender, race, disability, an ID or bank number). Job Catcher never answers those for you.",
  password: "That's a password box. Job Catcher never fills passwords.",
};

export function startPointing(tabId: number | null) {
  if (tabId != null) send({ type: "startPick", tabId });
}

export function Point({ pick }: { pick: Pick }) {
  const { tab } = usePanel();
  const stop = () => tab.id != null && send({ type: "stopPick", tabId: tab.id });
  // Held while pointing: closing the panel (or leaving This page) stops it,
  // so the page is never left swallowing clicks.
  React.useEffect(() => {
    if (tab.id == null) return;
    const port = chrome.runtime.connect({ name: `pick:${tab.id}` });
    return () => port.disconnect();
  }, [tab.id]);
  if (pick.state === "pointing") {
    return (
      <Card className="flex flex-col gap-2 border-primary/50" data-testid="pointing">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
          <MousePointerClick className="size-4" aria-hidden /> Pointing
        </span>
        <SectionTitle>Click the box on the page</SectionTitle>
        <Muted>Move over the page: each box lights up. Click the one you want filled. Press Esc on the page to stop.</Muted>
        <Button variant="outline" size="sm" onClick={stop} className="self-start">
          <Check />
          Done
        </Button>
      </Card>
    );
  }
  return <WhatGoesHere key={`${pick.at}`} pick={pick} onDone={stop} />;
}

function WhatGoesHere({ pick, onDone }: { pick: Pick; onDone: () => void }) {
  const { tab } = usePanel();
  const [values, setValues] = React.useState<Record<string, string[]>>({});
  const known = pick.known || null;
  const [text, setText] = React.useState(pick.value || known?.value || "");
  const [showList, setShowList] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [remember, setRemember] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [failed, setFailed] = React.useState("");
  const [notSaved, setNotSaved] = React.useState(false);

  React.useEffect(() => {
    send({ type: "getAutofillCopy" }).then((res) => {
      const c = res?.copy;
      if (c) setValues(profileValues(c.profile || {}, c.email || "", new Date(), c.history) as Record<string, string[]>);
    });
  }, []);

  async function fill(choice: { profile_key?: string; answer?: string; updateProfile?: boolean }, keep: boolean, tag: string) {
    if (tab.id == null) return;
    setBusy(tag);
    setFailed("");
    const res = await send({ type: "fillPicked", tabId: tab.id, ...choice, remember: keep });
    setBusy("");
    if (res?.ok && keep && !res.remembered) setNotSaved(true);
    if (!res?.ok)
      setFailed(
        res?.reason === "no_data"
          ? "Your profile doesn't have that yet."
          : res?.reason === "rejected"
            ? "The page didn't take that answer. Try another."
            : res?.reason === "profile" || res?.reason === "not_profile"
              ? "Couldn't update your profile with that. Check it and try again."
              : "Couldn't fill that box. Point at it again.",
      );
  }

  const label = pick.field?.label || "This box";
  const keyName = (k: string) => ANSWERS.find(([key]) => key === k)?.[1] || k.replace(/_/g, " ");
  const thinks =
    known?.source === "profile" && known.key
      ? `${keyName(known.key)} (from your profile)`
      : known?.source === "learned"
        ? "A remembered answer"
        : "Not known yet";
  const options = pick.field?.options || [];
  const q = query.trim().toLowerCase();
  const choices = ANSWERS.filter(([key, name]) => values[key]?.length && (!q || name.toLowerCase().includes(q) || String(values[key][0]).toLowerCase().includes(q)));
  const answer = text.trim();
  return (
    <Card className="flex flex-col gap-3 border-primary/50" data-testid="what-goes-here">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">What goes here?</span>
          <SectionTitle className="truncate">{label}</SectionTitle>
          <Muted>on {pick.site}</Muted>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Stop pointing" onClick={onDone}>
          <X />
        </Button>
      </div>
      {pick.refused ? (
        <>
          <Alert tone="warning">{REFUSED[pick.refused] || REFUSED.sensitive}</Alert>
          <Button variant="outline" size="sm" className="self-start" onClick={() => startPointing(tab.id)}>
            <MousePointerClick />
            Point at another box
          </Button>
        </>
      ) : (
        <>
          <p className="text-xs" data-testid="thinks">
            <span className="text-muted-foreground">Job Catcher thinks: </span>
            <b className="font-medium">{thinks}</b>
          </p>
          {pick.autoSaved && (
            <Alert tone="success">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>Saved “{pick.autoSaved.answer.slice(0, 60)}” for this box on {pick.site}.</span>
                <Button variant="ghost" size="sm" onClick={() => tab.id != null && send({ type: "undoPickSave", tabId: tab.id })}>
                  Undo
                </Button>
              </span>
            </Alert>
          )}
          {pick.alreadySaved && <Muted>Already saved: this box fills with it by itself.</Muted>}
          <label className="flex flex-col gap-1 text-xs font-medium">
            The answer
            {options.length ? (
              <Select aria-label="The answer" value={text} onChange={(e) => setText(e.target.value)}>
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : (
              <Textarea rows={2} maxLength={2000} aria-label="The answer" value={text} onChange={(e) => setText(e.target.value)} />
            )}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!answer || !!busy} busy={busy === "always"} onClick={() => fill({ answer }, true, "always")}>
              Always use this here
            </Button>
            <Button size="sm" variant="outline" disabled={!answer || !!busy} busy={busy === "once"} onClick={() => fill({ answer }, false, "once")}>
              Fill once
            </Button>
            {known?.source === "profile" && known.key && (
              <Button size="sm" variant="outline" disabled={!answer || !!busy} busy={busy === "profile"} onClick={() => fill({ answer, updateProfile: true }, false, "profile")}>
                Update my profile
              </Button>
            )}
          </div>
          <button
            type="button"
            className="cursor-pointer self-start text-xs text-primary underline underline-offset-2"
            aria-expanded={showList}
            onClick={() => setShowList((v) => !v)}
          >
            Or pick from your profile
          </button>
          {showList && (
            <>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
                <Input className="pl-8" placeholder="Search your answers" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search your answers" />
              </label>
              <ul className="flex max-h-64 flex-col overflow-auto rounded-lg border" aria-label="Your answers">
                {choices.map(([key, name]) => (
                  <li key={key} className="border-b last:border-b-0">
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => fill({ profile_key: key }, remember, key)}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    >
                      <span className="font-medium">{name}</span>
                      <span className="truncate text-xs text-muted-foreground">{busy === key ? "Filling…" : String(values[key][0])}</span>
                    </button>
                  </li>
                ))}
                {!choices.length && <li className="px-3 py-2 text-xs text-muted-foreground">No profile answer matches.</li>}
              </ul>
              <label className="flex cursor-pointer items-center justify-between gap-3 text-xs">
                <span>
                  <b className="font-medium">Remember for {pick.site}</b>
                  <span className="block text-muted-foreground">Next time this box fills by itself, on every computer.</span>
                </span>
                <Switch checked={remember} label={`Remember for ${pick.site}`} onCheckedChange={setRemember} />
              </label>
            </>
          )}
          {failed && <Alert tone="warning">{failed}</Alert>}
          {notSaved && <Alert tone="warning">Filled, but Job Catcher couldn't remember it this time (check you're signed in). Point at it again later to teach it.</Alert>}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => startPointing(tab.id)}>
            <MousePointerClick />
            Point at another box
          </Button>
        </>
      )}
    </Card>
  );
}

/** Settings: the boxes taught, per site, with Remove. */
export function TaughtList() {
  const [items, setItems] = React.useState<{ id: string; site: string; label: string; profile_key: string | null; answer_preview: string | null }[] | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    const res = await send({ type: "listTaught" });
    if (res?.ok) {
      setItems(res.items || []);
      setError("");
    } else setError("Couldn't load taught boxes.");
  }, []);
  React.useEffect(() => {
    load();
    // A box taught (or removed) anywhere: show it.
    const onMessage = (msg: { type?: string }) => {
      if (msg?.type === "taughtChanged") load();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [load]);
  const name = (k: string | null) => ANSWERS.find(([key]) => key === k)?.[1] || k || "";
  return (
    <Card className="flex flex-col gap-2" data-testid="taught-list">
      <Muted className="font-medium uppercase tracking-wide">Boxes you taught</Muted>
      {error && <Muted>{error}</Muted>}
      {items && !items.length && <Muted>None yet. When a box isn't filled, use “Point at a box” in This page.</Muted>}
      <ul className="flex flex-col divide-y">
        {(items || []).map((t) => (
          <li key={t.id} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{t.label || "A box"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {t.site} → {t.profile_key ? name(t.profile_key) : `“${t.answer_preview}”`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await send({ type: "forgetTaught", id: t.id });
                load();
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
