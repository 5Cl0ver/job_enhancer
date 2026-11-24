import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle, Loader2 } from "lucide-react";
import { ResumeUpload } from "@/components/ai/ResumeUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useResumes } from "@/hooks/useAI";
import {
  useApplicationProfile,
  useFillProfileFromResume,
  useUpdateApplicationProfile,
  type ApplicationProfile,
} from "@/hooks/useApplicationProfile";
import { useUpdateOnboarding } from "@/hooks/useOnboarding";
import { useReadResume, useResumeDetails } from "@/hooks/useResumeDetails";

const FIELDS: { key: keyof ApplicationProfile; label: string; auto?: string; wide?: boolean }[] = [
  { key: "first_name", label: "First name", auto: "given-name" },
  { key: "last_name", label: "Last name", auto: "family-name" },
  { key: "phone", label: "Phone", auto: "tel" },
  { key: "city", label: "City", auto: "address-level2" },
  { key: "state", label: "State", auto: "address-level1" },
  { key: "linkedin_url", label: "LinkedIn (optional)", wide: true },
];

export const READ_FAILED =
  "We saved your résumé but couldn't read it right now. Fill these in by hand, or try again later.";

/**
 * Welcome step 1 (spec 019, contracts/ui.md): upload a résumé, then check
 * what was read from it. Read with the built-in reader, no AI (research R13).
 * Nothing counts as checked until the person presses Looks right.
 */
export function ResumeStep({ onDone }: { onDone: () => void }) {
  const { data: resumes, isLoading } = useResumes();
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const active = resumes?.find((r) => r.is_active) ?? resumes?.[0];
  const id = resumeId ?? active?.id ?? null;

  if (isLoading) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />;

  if (!id || replacing) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Add your résumé and we'll fill in your details from it. You'll check them next.
        </p>
        <ResumeUpload
          onUploaded={(r) => {
            setResumeId(r.id);
            setFresh(true);
            setReplacing(false);
          }}
        />
      </div>
    );
  }

  const name = resumes?.find((r) => r.id === id)?.filename;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">
        <CheckCircle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">{name ?? "Your résumé"}</span>
        <button type="button" className="shrink-0 text-xs underline underline-offset-2" onClick={() => setReplacing(true)}>
          Use another
        </button>
      </div>
      <Review key={id} resumeId={id} fresh={fresh} onDone={onDone} />
    </div>
  );
}

function Review({ resumeId, fresh, onDone }: { resumeId: string; fresh: boolean; onDone: () => void }) {
  const fill = useFillProfileFromResume();
  const read = useReadResume(resumeId);
  const details = useResumeDetails(resumeId);
  const { data: saved, isError: savedFailed } = useApplicationProfile();
  const save = useUpdateApplicationProfile();
  const step = useUpdateOnboarding();
  const [form, setForm] = useState<Partial<ApplicationProfile> | null>(null);
  const started = useRef(false);

  // Once the saved profile is known: a résumé just uploaded (or a profile
  // with none of these filled yet) is read into it, empty fields only; else
  // the saved profile is shown as it is. Reading fails → the saved one,
  // never a blank form that would wipe it.
  useEffect(() => {
    if (started.current || (!saved && !savedFailed)) return;
    started.current = true;
    const blank = !saved || FIELDS.every((f) => !saved[f.key]);
    if (fresh) read.mutate();
    if (fresh || blank) {
      fill.mutate(undefined, {
        onSuccess: (r) => setForm(r.profile),
        onError: () => setForm(saved ?? {}),
      });
    } else {
      setForm(saved);
    }
  }, [saved, savedFailed, fresh, fill, read]);

  if (!form) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading your résumé…
      </p>
    );
  }

  const jobs = details.data?.work.length ?? 0;
  const schools = details.data?.education.length ?? 0;
  const set = (key: keyof ApplicationProfile, value: string) =>
    setForm((f) => ({ ...f, [key]: value || null }));

  const confirm = () => {
    const reviewed = () =>
      step.mutate({ profile_reviewed: true, welcome_step: 2 }, { onSuccess: onDone });
    // Only what the person changed here: nothing else in the profile is touched.
    const before = (fill.data?.profile ?? saved ?? {}) as Partial<ApplicationProfile>;
    const changes = Object.fromEntries(
      FIELDS.filter((f) => (form[f.key] ?? null) !== (before[f.key] ?? null)).map((f) => [
        f.key,
        form[f.key] ?? null,
      ]),
    );
    if (Object.keys(changes).length) save.mutate(changes, { onSuccess: reviewed });
    else reviewed();
  };

  return (
    <div className="flex flex-col gap-4">
      {fill.isError && (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {READ_FAILED}
        </p>
      )}
      <p className="text-sm text-muted-foreground">Check these. Fix anything that's wrong.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.wide ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
            <Label htmlFor={`welcome-${f.key}`}>{f.label}</Label>
            <Input
              id={`welcome-${f.key}`}
              autoComplete={f.auto}
              value={(form[f.key] as string | null) ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground" data-testid="welcome-found">
        {details.isLoading || read.isPending ? (
          "Reading your jobs and schools…"
        ) : (
          <>
            We found {jobs} {jobs === 1 ? "job" : "jobs"} and {schools} {schools === 1 ? "school" : "schools"} on your
            résumé. Job Catcher fills job applications with them.{" "}
            <Link to="/autofill" className="font-medium text-primary underline underline-offset-2">
              Check them
            </Link>
          </>
        )}
      </p>
      {save.isError && (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message || "Couldn't save. Check the phone number and try again."}
        </p>
      )}
      <Button onClick={confirm} disabled={save.isPending || step.isPending} className="self-start" size="lg">
        {save.isPending || step.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Looks right
      </Button>
    </div>
  );
}
