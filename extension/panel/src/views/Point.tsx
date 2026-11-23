// "Point at a box" (spec 017): while pointing, the panel says what to do; once
// a box on the page is clicked, it asks "What goes here?" — the profile's
// answers or typed text — fills it, remembers it for that site (in the
// account, so on every computer) and points again for the next box.
import * as React from "react";
import { Check, MousePointerClick, Search, X } from "lucide-react";
import { Alert, Button, Card, Input, Muted, SectionTitle, Switch, Textarea } from "@/ui";
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
  const [query, setQuery] = React.useState("");
  const [other, setOther] = React.useState("");
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

  async function fill(choice: { profile_key?: string; answer?: string }) {
    if (tab.id == null) return;
    setBusy(choice.profile_key || "other");
    setFailed("");
    const res = await send({ type: "fillPicked", tabId: tab.id, ...choice, remember });
    setBusy("");
    // Filled, but not remembered (signed out, the app asleep): say so — never
    // promise "next time" when it won't be.
    if (res?.ok && remember && !res.remembered) setNotSaved(true);
    if (!res?.ok)
      setFailed(
        res?.reason === "no_data"
          ? "Your profile doesn't have that yet."
          : res?.reason === "rejected"
            ? "The page didn't take that answer. Try another."
            : "Couldn't fill that box. Point at it again.",
      );
  }

  const label = pick.field?.label || "This box";
  const q = query.trim().toLowerCase();
  const choices = ANSWERS.filter(([key, name]) => values[key]?.length && (!q || name.toLowerCase().includes(q) || String(values[key][0]).toLowerCase().includes(q)));
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
          {pick.field?.options?.length ? (
            <Muted>
              Its choices: {pick.field.options.slice(0, 6).join(", ")}
              {pick.field.options.length > 6 ? "…" : ""}
            </Muted>
          ) : null}
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
                  onClick={() => fill({ profile_key: key })}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <span className="font-medium">{name}</span>
                  <span className="truncate text-xs text-muted-foreground">{busy === key ? "Filling…" : String(values[key][0])}</span>
                </button>
              </li>
            ))}
            {!choices.length && <li className="px-3 py-2 text-xs text-muted-foreground">No profile answer matches. Type it below.</li>}
          </ul>
          <div className="flex flex-col gap-2">
            <Textarea rows={2} maxLength={2000} placeholder="Something else: type the answer" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Something else" />
            <Button size="sm" variant="outline" className="self-start" disabled={!other.trim() || !!busy} busy={busy === "other"} onClick={() => fill({ answer: other.trim() })}>
              Fill this
            </Button>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3 text-xs">
            <span>
              <b className="font-medium">Remember for {pick.site}</b>
              <span className="block text-muted-foreground">Next time this box fills by itself, on every computer.</span>
            </span>
            <Switch checked={remember} label={`Remember for ${pick.site}`} onCheckedChange={setRemember} />
          </label>
          {failed && <Alert tone="warning">{failed}</Alert>}
          {notSaved && <Alert tone="warning">Filled, but Job Catcher couldn't remember it this time (check you're signed in). Point at it again later to teach it.</Alert>}
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
