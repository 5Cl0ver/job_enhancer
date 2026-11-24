import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAllowances, useSaveAllowances } from "@/hooks/useAdmin";
import type { Allowances } from "@/types/api";

const FIELDS: { key: keyof Allowances; label: string }[] = [
  { key: "live_search", label: "Live searches a day" },
  { key: "ai_document", label: "AI documents a day" },
  { key: "ai_read", label: "AI résumé reads a day" },
  { key: "ai_autofill", label: "AI autofill helps a day" },
  { key: "jsearch_month_cap", label: "JSearch a month (everyone)" },
  { key: "jsearch_owner_reserve", label: "Kept for you each month" },
];

/**
 * The free allowances (spec 019 part C): how much of the shared free services
 * each person gets a day, and the part of the JSearch month kept for you.
 * You're never limited. New numbers apply from each person's next use.
 */
export function AllowancesCard() {
  const { data } = useAllowances();
  const save = useSaveAllowances();
  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data) setForm(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])));
  }, [data]);

  const values = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)]));
  const valid = Object.values(form).every((v) => /^\d{1,5}$/.test(v) && Number(v) <= 10_000);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Allowances</CardTitle>
        <CardDescription>
          How much of the shared free services each person gets a day (resets at midnight
          Pacific). You're never limited.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`allow-${f.key}`}>{f.label}</Label>
              <Input
                id={`allow-${f.key}`}
                inputMode="numeric"
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value.trim() }))}
              />
            </div>
          ))}
        </div>
        {save.isError && (
          <p role="alert" className="text-sm text-destructive">
            {save.error.message}
          </p>
        )}
        <Button
          disabled={!data || !valid || save.isPending}
          onClick={() =>
            save.mutate(values as Partial<Allowances>, {
              onSuccess: () => {
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
              },
            })
          }
          className="gap-1.5"
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? "Saved" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
