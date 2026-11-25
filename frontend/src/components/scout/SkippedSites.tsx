import { useEffect, useRef, useState } from "react";
import { Ban, Plus, X } from "lucide-react";

import { errorText } from "@/components/scout/errorText";
import {
  NeedsConfirm,
  useAddSkippedSite,
  useRemoveSkippedSite,
  useSiteSuggestions,
  useSkippedSites,
} from "@/hooks/useSkippedSites";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX = 100;

/**
 * Sites to skip (spec 024): Claude Scout never brings jobs from these sites and
 * Apply with Claude never applies through them. Paste a link or a site; the
 * app keeps just the site. Suggestions come from the user's own Scout finds
 * and are only ever added with a tap. `#sites-to-skip` (from Settings) scrolls
 * here.
 */
export function SkippedSites() {
  const { data: sites = [], isLoading, isError } = useSkippedSites();
  const { data: suggestions = [] } = useSiteSuggestions();
  const add = useAddSkippedSite();
  const remove = useRemoveSkippedSite();
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ site: string; why: string } | null>(null);
  const ref = useRef<HTMLElement>(null);

  // Opened from Settings' link: show this card first.
  useEffect(() => {
    if (window.location.hash === "#sites-to-skip") ref.current?.scrollIntoView?.({ block: "start" });
  }, []);

  const submit = (site: string, sure = false) => {
    setNote(null);
    add.mutate(
      { site, confirm: sure },
      {
        onSuccess: (r) => {
          setConfirm(null);
          setDraft("");
          setNote(r.already ? `${r.host} is already on your list.` : null);
        },
        onError: (e) => {
          if (e instanceof NeedsConfirm) setConfirm({ site, why: e.why });
          else setNote(errorText(e, "Couldn't add it. Try again."));
        },
      },
    );
  };
  const full = sites.length >= MAX;

  return (
    <section
      ref={ref}
      id="sites-to-skip"
      aria-labelledby="sites-to-skip-title"
      className="scroll-mt-16 space-y-3 rounded-lg border bg-card p-3"
    >
      <div>
        <h3 id="sites-to-skip-title" className="flex items-center gap-1.5 font-medium">
          <Ban className="h-4 w-4 text-muted-foreground" aria-hidden />
          Sites to skip
        </h3>
        <p className="text-xs text-muted-foreground">
          Claude never brings jobs from these sites or applies through them.
        </p>
      </div>

      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) submit(draft.trim());
        }}
      >
        <Label htmlFor="skip-site" className="sr-only">
          Paste a link or a site
        </Label>
        <div className="flex gap-2">
          <Input
            id="skip-site"
            value={draft}
            maxLength={2000}
            placeholder="Paste a link or a site"
            autoComplete="off"
            spellCheck={false}
            disabled={full}
            onChange={(e) => {
              setDraft(e.target.value);
              setNote(null);
              setConfirm(null);
            }}
          />
          <Button
            type="submit"
            variant="outline"
            className="shrink-0 gap-1 pointer-coarse:min-h-11"
            disabled={!draft.trim() || full || add.isPending}
          >
            <Plus className="h-4 w-4" aria-hidden /> Add
          </Button>
        </div>
        {full && (
          <p className="text-xs text-muted-foreground">
            That's the most ({MAX}). Remove one to add another.
          </p>
        )}
        {note && (
          <p role="status" className="text-xs text-muted-foreground">
            {note}
          </p>
        )}
      </form>

      {confirm && (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm"
        >
          <p>{confirm.why}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={add.isPending}
              onClick={() => submit(confirm.site, true)}
            >
              Skip it anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-xs text-destructive">Couldn't load your list. Try again.</p>
      ) : sites.length === 0 ? (
        <p className="text-xs text-muted-foreground">None yet.</p>
      ) : (
        <ul className="divide-y text-sm" aria-label="Sites to skip">
          {sites.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-0.5">
              <span className="min-w-0 [overflow-wrap:anywhere]">{s.host}</span>
              <button
                type="button"
                onClick={() => remove.mutate(s.id)}
                disabled={remove.isPending && remove.variables === s.id}
                aria-label={`Remove ${s.host}`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 && !full && (
        <div className="space-y-1 border-t pt-2">
          <p className="text-xs text-muted-foreground">Seen in your Scout finds:</p>
          <ul className="divide-y text-sm" aria-label="Suggested sites">
            {suggestions.map((s) => (
              <li key={s.host} className="flex items-center justify-between gap-2 py-1">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {s.host}{" "}
                  <span className="text-xs text-muted-foreground">
                    · {s.finds} {s.finds === 1 ? "find" : "finds"}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={add.isPending}
                  onClick={() => submit(s.host)}
                  aria-label={`Skip it: ${s.host}`}
                >
                  Skip it
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
