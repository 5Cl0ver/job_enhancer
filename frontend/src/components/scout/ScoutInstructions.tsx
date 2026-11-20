import { useState } from "react";
import { ChevronDown, ChevronRight, Eye, Lock } from "lucide-react";

import { InstructionEditor } from "@/components/scout/InstructionEditor";
import { ScoutPreview } from "@/components/scout/ScoutPreview";
import { useInstructions } from "@/hooks/useScout";
import { INSTRUCTION_HINT, type InstructionSection } from "@/lib/scout";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

/**
 * Everything Claude Scout tells Claude, in the order a run gives it: the
 * user's editable parts first, then the parts that are locked. Edits are for
 * this account only and apply to runs started after saving.
 */
export function ScoutInstructions() {
  const { data, isLoading, isError } = useInstructions();
  if (isLoading) return <Skeleton className="h-64" />;
  if (isError || !data)
    return (
      <p className="text-sm text-destructive">
        Couldn't load the instructions. Try again.
      </p>
    );

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Everything Claude is told on a Scout run. Change what you like: edits
        are only for your account and apply to searches you start after
        saving. A search already going keeps what it started with.
      </p>

      <Group title="What you can change">
        {data.sections.map((s) => (
          <Section key={s.key} section={s}>
            {s.key === "rubric" && (
              <p className="text-xs text-muted-foreground">
                Claude gets this line: “{data.rubric_text}”
              </p>
            )}
            <InstructionEditor key={`${s.key}-${s.edited_at ?? "original"}`} section={s} />
          </Section>
        ))}
      </Group>

      <Group title="Always the same" locked>
        <Folded title="Rules Claude always follows" open locked>
          <p className="text-xs text-muted-foreground">
            Sent after your main steps on every run, so no edit can remove them.
          </p>
          <pre className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
            {data.locked_rules}
          </pre>
        </Folded>
        <Folded title="Limits that don't change" locked>
          <dl className="space-y-1 text-sm">
            {data.fixed_limits.map((l) => (
              <div key={l.label} className="flex flex-wrap justify-between gap-x-3">
                <dt>{l.label}</dt>
                <dd className="text-muted-foreground">{l.value}</dd>
              </div>
            ))}
          </dl>
        </Folded>
        <Folded title="What each tool tells Claude" locked>
          <p className="text-xs text-muted-foreground">
            The app's logic depends on this wording. Every reply the app gives
            Claude during a run is in that run's Log, in History.
          </p>
          <ul className="space-y-3">
            {data.tools.map((t) => (
              <li key={t.name} className="space-y-0.5">
                <p className="font-mono text-xs font-medium">{t.name}</p>
                <p className="whitespace-pre-wrap text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {t.description}
                </p>
              </li>
            ))}
          </ul>
          {data.connector_note && (
            <div className="space-y-0.5 border-t pt-2">
              <p className="text-xs font-medium">About the connector itself</p>
              <p className="whitespace-pre-wrap text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {data.connector_note}
              </p>
            </div>
          )}
        </Folded>
      </Group>

      <Group title="Preview">
        <Folded title="What Claude would get for a search" icon={<Eye className="h-4 w-4" aria-hidden />}>
          <ScoutPreview />
        </Folded>
      </Group>
    </div>
  );
}

function Group({
  title,
  locked = false,
  children,
}: {
  title: string;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {locked && <Lock className="h-3.5 w-3.5" aria-hidden />}
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** One editable section, folded until opened. */
function Section({
  section: s,
  children,
}: {
  section: InstructionSection;
  children: React.ReactNode;
}) {
  const badge = s.edited ? (
    <Badge variant="secondary" className="font-normal">
      Edited{" "}
      {s.edited_at &&
        new Date(s.edited_at).toLocaleDateString(undefined, DAY)}
    </Badge>
  ) : (
    <Badge variant="outline" className="font-normal">
      Original
    </Badge>
  );
  return (
    <Folded title={s.title} badge={badge} hint={INSTRUCTION_HINT[s.key]}>
      {s.original_changed && (
        <OriginalChanged original={s.original} />
      )}
      {children}
    </Folded>
  );
}

function OriginalChanged({ original }: { original: InstructionSection["original"] }) {
  const [show, setShow] = useState(false);
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
      <p>
        The app's original changed since you edited this.{" "}
        <button
          type="button"
          className="font-medium underline underline-offset-2"
          onClick={() => setShow((v) => !v)}
        >
          {show ? "Hide the new original" : "See the new original"}
        </button>
      </p>
      {show && (
        <pre className="mt-2 whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">
          {typeof original === "string" ? original : JSON.stringify(original, null, 1)}
        </pre>
      )}
    </div>
  );
}

function Folded({
  title,
  hint,
  badge,
  locked = false,
  open: startOpen = false,
  icon,
  children,
}: {
  title: string;
  hint?: string;
  badge?: React.ReactNode;
  locked?: boolean;
  open?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 p-3 text-left hover:bg-muted/50 pointer-coarse:min-h-11"
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 font-medium">
            {icon}
            {title}
            {locked && (
              <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Locked" />
            )}
            {badge}
          </span>
          {hint && (
            <span className="block text-xs text-muted-foreground">{hint}</span>
          )}
        </span>
      </button>
      {open && <div className="space-y-3 px-3 pb-3">{children}</div>}
    </div>
  );
}
