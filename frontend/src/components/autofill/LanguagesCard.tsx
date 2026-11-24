import { useEffect, useState } from "react";
import { Check, Languages, Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useApplicationProfile,
  useUpdateApplicationProfile,
  type LanguageEntry,
} from "@/hooks/useApplicationProfile";

const ABILITIES = [
  ["overall", "Overall"],
  ["comprehension", "Understanding"],
  ["reading", "Reading"],
  ["speaking", "Speaking"],
  ["writing", "Writing"],
] as const;
const LEVELS = ["1 · Beginner", "2 · Basic", "3 · Intermediate", "4 · Advanced", "5 · Fluent"];
const NEW_LANGUAGE: LanguageEntry = { language: "", native: false, overall: null, comprehension: null, reading: null, speaking: null, writing: null };
const nativeSelect =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm pointer-coarse:h-11 pointer-coarse:text-base focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * Languages (spec 020): what Job Catcher puts in language sections — the
 * language, "I'm fluent", and a level from 1 to 5 for each ability. A level
 * left empty uses Overall; a fluent language counts as 5.
 */
export function LanguagesCard() {
  const { data, isLoading } = useApplicationProfile();
  const save = useUpdateApplicationProfile();
  const [draft, setDraft] = useState<LanguageEntry[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setDraft(data.languages ?? []);
  }, [data]);

  const set = (i: number, patch: Partial<LanguageEntry>) => {
    setSaved(false);
    setDraft((d) => d.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  };

  async function onSave() {
    setSaved(false);
    await save.mutateAsync({ languages: draft.filter((l) => l.language.trim()).map((l) => ({ ...l, language: l.language.trim() })) });
    setSaved(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="h-5 w-5" aria-hidden />
          Languages
        </CardTitle>
        <CardDescription>
          For applications that ask which languages you speak. A level left empty uses Overall.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : (
          <>
            {draft.map((l, i) => {
              const name = l.language || `Language ${i + 1}`;
              return (
                <fieldset key={i} className="flex flex-col gap-2 rounded-lg border p-3">
                  <legend className="px-1 text-xs text-muted-foreground">Language {i + 1}</legend>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="min-w-0 flex-1"
                      aria-label={`Language ${i + 1}`}
                      placeholder="Language (e.g. Spanish)"
                      maxLength={60}
                      value={l.language}
                      onChange={(e) => set(i, { language: e.target.value })}
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={l.native} onChange={(e) => set(i, { native: e.target.checked })} />
                      Fluent or native
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {ABILITIES.map(([key, label]) => (
                      <label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {label}
                        <select
                          className={nativeSelect}
                          aria-label={`${name} ${label.toLowerCase()} level`}
                          value={l[key] ?? ""}
                          onChange={(e) => set(i, { [key]: e.target.value ? Number(e.target.value) : null })}
                        >
                          <option value="">—</option>
                          {LEVELS.map((t, n) => (
                            <option key={t} value={n + 1}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-end"
                    aria-label={`Remove ${name}`}
                    onClick={() => {
                      setSaved(false);
                      setDraft((d) => d.filter((_, k) => k !== i));
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </Button>
                </fieldset>
              );
            })}
            {!draft.length && <p className="text-sm text-muted-foreground">No languages yet.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={draft.length >= 10} onClick={() => setDraft((d) => [...d, { ...NEW_LANGUAGE }])}>
                <Plus className="h-4 w-4" /> Add a language
              </Button>
              <Button type="button" size="sm" onClick={onSave} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save languages
              </Button>
              {saved && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground" role="status">
                  <Check className="h-4 w-4" /> Saved
                </span>
              )}
              {save.isError && (
                <span className="text-sm text-destructive" role="alert">
                  Couldn't save. Check each language has a name, then try again.
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
