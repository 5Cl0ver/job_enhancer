import { useEffect, useState } from "react";
import { AsYouType, isValidPhoneNumber } from "libphonenumber-js";
import { BriefcaseBusiness, Check, Loader2, Sparkles } from "lucide-react";
import { US_STATES, COUNTRIES, NOTICE_PERIODS } from "@/lib/form-options";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useApplicationProfile,
  useUpdateApplicationProfile,
  useFillProfileFromResume,
  type ApplicationProfile,
} from "@/hooks/useApplicationProfile";
import { useResumes } from "@/hooks/useAI";

/** Fields counted toward the completeness hint (what autofill can use). */
const COMPLETENESS_KEYS: (keyof ApplicationProfile)[] = [
  "first_name",
  "last_name",
  "phone",
  "city",
  "linkedin_url",
  "github_url",
  "authorized_to_work",
  "requires_sponsorship",
  "willing_to_relocate",
  "desired_salary",
];

// Radix Select forbids empty values — tri-state yes/no/unanswered sentinels.
const UNSET = "unset";

/** Format a phone as the user types — "(555) 010-0199" like real forms do.
 *  Numbers starting with "+" format internationally. */
function formatPhone(raw: string): string {
  if (!raw) return "";
  return new AsYouType(raw.startsWith("+") ? undefined : "US").input(raw);
}

/** A phone is acceptable when empty or actually dialable (libphonenumber —
 *  the same validation real application forms use). */
function phoneOk(value: string | null): boolean {
  if (!value) return true;
  return value.startsWith("+")
    ? isValidPhoneNumber(value)
    : isValidPhoneNumber(value, "US");
}

/** "linkedin.com/in/me" → "https://linkedin.com/in/me" on blur. */
function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return v.includes(".") ? `https://${v}` : v;
}

function TriState({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value === null ? UNSET : value ? "yes" : "no"}
        onValueChange={(v) => onChange(v === UNSET ? null : v === "yes")}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>Not answered</SelectItem>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * The "profile vault": every answer job applications keep asking for, filled
 * once. This is the data source for the extension's ATS autofill.
 */
export function ApplicationProfileCard() {
  const { data: saved, isLoading } = useApplicationProfile();
  const update = useUpdateApplicationProfile();
  const fillFromResume = useFillProfileFromResume();
  const { data: resumes = [] } = useResumes();
  const hasResume = resumes.some((r) => r.is_active);
  const [filledMsg, setFilledMsg] = useState<string | null>(null);
  const [form, setForm] = useState<ApplicationProfile | null>(null);

  // Load the saved profile into local form state once it arrives.
  useEffect(() => {
    if (saved && !form) setForm(saved);
  }, [saved, form]);

  const handleFillFromResume = () => {
    setFilledMsg(null);
    fillFromResume.mutate(undefined, {
      onSuccess: (result) => {
        // Merge server-filled values into the form, but only where the LOCAL
        // form is still empty — unsaved typing is never clobbered either.
        setForm((f) => {
          if (!f) return result.profile;
          const merged = { ...f };
          for (const key of result.filled as (keyof ApplicationProfile)[]) {
            if (merged[key] === null || merged[key] === "") {
              merged[key] = result.profile[key] as never;
            }
          }
          return merged;
        });
        setFilledMsg(
          result.filled.length
            ? `Filled from your resume: ${result.filled.join(", ").replace(/_/g, " ")}`
            : "Nothing new found — your resume doesn't state more than what's already here.",
        );
      },
    });
  };

  if (isLoading || !form) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Application Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const filled = COMPLETENESS_KEYS.filter((k) => {
    const v = form[k];
    return v !== null && v !== "";
  }).length;

  const set = <K extends keyof ApplicationProfile>(key: K, value: ApplicationProfile[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const text = (key: keyof ApplicationProfile) => ({
    value: (form[key] as string | null) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      set(key, (e.target.value || null) as ApplicationProfile[typeof key]),
  });

  // Save is blocked while the phone is invalid — like a real form would.
  const canSave = phoneOk(form.phone) && !update.isPending;
  const handleSave = () => {
    if (!canSave) return;
    update.mutate(form);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-1.5">
            <BriefcaseBusiness className="h-4 w-4" aria-hidden />
            Application Profile
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {filled}/{COMPLETENESS_KEYS.length} filled
          </span>
        </CardTitle>
        <CardDescription>
          Answer these once — applications ask for them every time. This powers
          one-click form autofill on job applications.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ap-first">First name</Label>
            <Input id="ap-first" autoComplete="given-name" {...text("first_name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-last">Last name</Label>
            <Input id="ap-last" autoComplete="family-name" {...text("last_name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-phone">Phone</Label>
            <Input
              id="ap-phone"
              type="tel"
              autoComplete="tel"
              placeholder="(555) 010-0199"
              value={form.phone ?? ""}
              onChange={(e) => set("phone", formatPhone(e.target.value) || null)}
              aria-invalid={!phoneOk(form.phone)}
              className={!phoneOk(form.phone) ? "border-destructive" : undefined}
            />
            {!phoneOk(form.phone) && (
              <p className="text-xs text-destructive">
                That doesn't look like a real phone number.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-city">City</Label>
            <Input id="ap-city" {...text("city")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-state">State</Label>
            {/* US → pick from the real state list; elsewhere → free text. */}
            {!form.country || form.country === "United States" ? (
              <Select
                value={form.state ?? UNSET}
                onValueChange={(v) => set("state", v === UNSET ? null : v)}
              >
                <SelectTrigger id="ap-state">
                  <SelectValue placeholder="Select a state…" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={UNSET}>Not set</SelectItem>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input id="ap-state" placeholder="State / region" {...text("state")} />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-country">Country</Label>
            <Select
              value={form.country ?? UNSET}
              onValueChange={(v) => set("country", v === UNSET ? null : v)}
            >
              <SelectTrigger id="ap-country">
                <SelectValue placeholder="Select a country…" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={UNSET}>Not set</SelectItem>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ap-linkedin">LinkedIn URL</Label>
            <Input
              id="ap-linkedin"
              placeholder="linkedin.com/in/…"
              {...text("linkedin_url")}
              onBlur={() => set("linkedin_url", normalizeUrl(form.linkedin_url))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-github">GitHub URL</Label>
            <Input
              id="ap-github"
              placeholder="github.com/…"
              {...text("github_url")}
              onBlur={() => set("github_url", normalizeUrl(form.github_url))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-portfolio">Portfolio URL</Label>
            <Input
              id="ap-portfolio"
              placeholder="yoursite.dev"
              {...text("portfolio_url")}
              onBlur={() => set("portfolio_url", normalizeUrl(form.portfolio_url))}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <TriState
            id="ap-auth"
            label="Authorized to work in the US?"
            value={form.authorized_to_work}
            onChange={(v) => set("authorized_to_work", v)}
          />
          <TriState
            id="ap-sponsor"
            label="Require sponsorship?"
            value={form.requires_sponsorship}
            onChange={(v) => set("requires_sponsorship", v)}
          />
          <TriState
            id="ap-relocate"
            label="Willing to relocate?"
            value={form.willing_to_relocate}
            onChange={(v) => set("willing_to_relocate", v)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ap-salary">Desired salary (yearly USD)</Label>
            <Input
              id="ap-salary"
              type="number"
              min={0}
              value={form.desired_salary ?? ""}
              onChange={(e) =>
                set("desired_salary", e.target.value === "" ? null : Number(e.target.value))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-notice">Notice period</Label>
            <Select
              value={form.notice_period ?? UNSET}
              onValueChange={(v) => set("notice_period", v === UNSET ? null : v)}
            >
              <SelectTrigger id="ap-notice">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Not set</SelectItem>
                {NOTICE_PERIODS.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
                {/* Preserve a custom value saved before this became a dropdown. */}
                {form.notice_period &&
                  !NOTICE_PERIODS.includes(
                    form.notice_period as (typeof NOTICE_PERIODS)[number],
                  ) && (
                    <SelectItem value={form.notice_period}>{form.notice_period}</SelectItem>
                  )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleSave} disabled={!canSave} className="gap-2">
            {update.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : update.isSuccess ? (
              <Check className="h-4 w-4" />
            ) : null}
            {update.isPending ? "Saving…" : update.isSuccess ? "Saved" : "Save profile"}
          </Button>
          <Button
            variant="outline"
            onClick={handleFillFromResume}
            disabled={!hasResume || fillFromResume.isPending}
            title={hasResume ? undefined : "Upload a resume in AI Apply first"}
            className="gap-2"
          >
            {fillFromResume.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {fillFromResume.isPending ? "Reading resume…" : "Fill from resume"}
          </Button>
          {update.isError && (
            <span className="text-xs text-destructive">
              Couldn't save — check the URLs start with https://
            </span>
          )}
          {fillFromResume.isError && (
            <span className="text-xs text-destructive">
              Couldn't read your resume — try again in a minute.
            </span>
          )}
        </div>
        {filledMsg && <p className="text-xs text-muted-foreground">{filledMsg}</p>}
        {!hasResume && (
          <p className="text-xs text-muted-foreground">
            Tip: upload a resume in AI Apply and this can fill itself.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
