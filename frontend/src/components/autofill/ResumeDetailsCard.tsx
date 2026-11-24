import { useEffect, useState } from "react";
import { Check, FileText, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useResumes } from "@/hooks/useAI";
import {
  useReadResume,
  useResumeDetails,
  useSaveResumeDetails,
  type ResumeDetails,
  type SchoolEntry,
  type WorkEntry,
} from "@/hooks/useResumeDetails";

const EMPTY: ResumeDetails = { work: [], education: [], skills: [], certifications: [], websites: [] };
const NEW_JOB: WorkEntry = { title: "", company: "", location: "", start_month: null, start_year: null, end_month: null, end_year: null, current: false, description: "" };
const NEW_SCHOOL: SchoolEntry = { school: "", degree: "", field_of_study: "", start_year: null, end_year: null };

const num = (v: string) => (v.trim() ? Number(v) : null);
const lines = (v: string) => v.split(/\n/).map((s) => s.trim()).filter(Boolean);
const nativeSelect =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm pointer-coarse:h-11 pointer-coarse:text-base focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * Your résumé details (spec 020): what Job Catcher fills "enter your résumé
 * again" pages with — jobs, schools, skills, certifications, websites. Read
 * from each résumé file with no AI, so the user checks and fixes them here.
 */
export function ResumeDetailsCard() {
  const { data: resumes = [], isLoading } = useResumes();
  const [resumeId, setResumeId] = useState<string>("");
  useEffect(() => {
    if (!resumeId && resumes.length) setResumeId((resumes.find((r) => r.is_active) || resumes[0]).id);
  }, [resumes, resumeId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" aria-hidden />
          Your résumé details
        </CardTitle>
        <CardDescription>
          Job Catcher fills job, school and skills sections from these. Check them: they're read from your
          résumé file and may need a fix.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : !resumes.length ? (
          <p className="text-sm text-muted-foreground">Upload a résumé on AI Apply first; its details show up here.</p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Résumé
              <select className={nativeSelect} aria-label="Résumé" value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.filename}
                    {r.is_active ? " (your usual one)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {resumeId && <DetailsEditor key={resumeId} resumeId={resumeId} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DetailsEditor({ resumeId }: { resumeId: string }) {
  const { data, isLoading } = useResumeDetails(resumeId);
  const save = useSaveResumeDetails(resumeId);
  const reread = useReadResume(resumeId);
  const [draft, setDraft] = useState<ResumeDetails>(EMPTY);
  const [skills, setSkills] = useState("");
  const [certs, setCerts] = useState("");
  const [sites, setSites] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDraft({ work: data.work, education: data.education, skills: data.skills, certifications: data.certifications, websites: data.websites });
    setSkills(data.skills.join("\n"));
    setCerts(data.certifications.join("\n"));
    setSites(data.websites.join("\n"));
  }, [data]);

  if (isLoading || !data) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading details" />;

  const setJob = (i: number, patch: Partial<WorkEntry>) =>
    setDraft((d) => ({ ...d, work: d.work.map((j, k) => (k === i ? { ...j, ...patch } : j)) }));
  const setSchool = (i: number, patch: Partial<SchoolEntry>) =>
    setDraft((d) => ({ ...d, education: d.education.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));

  async function onSave() {
    setSaved(false);
    await save.mutateAsync({ ...draft, skills: lines(skills), certifications: lines(certs), websites: lines(sites) });
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-4">
      {!data.read && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          This résumé hasn't been read yet. Press Read my résumé, or type your details in.
        </p>
      )}
      {data.read && <p className="text-sm text-muted-foreground">Check these: read from your résumé.</p>}

      <section aria-label="Jobs" className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Jobs</h3>
        {draft.work.map((j, i) => (
          <fieldset key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs text-muted-foreground">Job {i + 1}</legend>
            <Input aria-label={`Job ${i + 1} title`} placeholder="Job title" value={j.title} onChange={(e) => setJob(i, { title: e.target.value })} />
            <Input aria-label={`Job ${i + 1} company`} placeholder="Company" value={j.company} onChange={(e) => setJob(i, { company: e.target.value })} />
            <Input aria-label={`Job ${i + 1} location`} placeholder="City, State" value={j.location} onChange={(e) => setJob(i, { location: e.target.value })} />
            <div className="grid grid-cols-4 gap-2">
              <Input aria-label={`Job ${i + 1} start month`} placeholder="MM" inputMode="numeric" value={j.start_month ?? ""} onChange={(e) => setJob(i, { start_month: num(e.target.value) })} />
              <Input aria-label={`Job ${i + 1} start year`} placeholder="YYYY" inputMode="numeric" value={j.start_year ?? ""} onChange={(e) => setJob(i, { start_year: num(e.target.value) })} />
              <Input aria-label={`Job ${i + 1} end month`} placeholder="MM" inputMode="numeric" disabled={j.current} value={j.end_month ?? ""} onChange={(e) => setJob(i, { end_month: num(e.target.value) })} />
              <Input aria-label={`Job ${i + 1} end year`} placeholder="YYYY" inputMode="numeric" disabled={j.current} value={j.end_year ?? ""} onChange={(e) => setJob(i, { end_year: num(e.target.value) })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={j.current} onChange={(e) => setJob(i, { current: e.target.checked, ...(e.target.checked ? { end_month: null, end_year: null } : {}) })} />
              I work here now
            </label>
            <Button type="button" variant="ghost" size="sm" className="justify-self-end" aria-label={`Remove job ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, work: d.work.filter((_, k) => k !== i) }))}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
            <Textarea className="sm:col-span-2" rows={3} aria-label={`Job ${i + 1} description`} placeholder="What you did" value={j.description} onChange={(e) => setJob(i, { description: e.target.value })} />
          </fieldset>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setDraft((d) => ({ ...d, work: [...d.work, NEW_JOB] }))}>
          <Plus className="h-4 w-4" /> Add a job
        </Button>
      </section>

      <section aria-label="Schools" className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Schools</h3>
        {draft.education.map((s, i) => (
          <fieldset key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs text-muted-foreground">School {i + 1}</legend>
            <Input aria-label={`School ${i + 1} name`} placeholder="School" value={s.school} onChange={(e) => setSchool(i, { school: e.target.value })} />
            <Input aria-label={`School ${i + 1} degree`} placeholder="Degree" value={s.degree} onChange={(e) => setSchool(i, { degree: e.target.value })} />
            <Input aria-label={`School ${i + 1} field`} placeholder="Field of study" value={s.field_of_study} onChange={(e) => setSchool(i, { field_of_study: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input aria-label={`School ${i + 1} start year`} placeholder="From (YYYY)" inputMode="numeric" value={s.start_year ?? ""} onChange={(e) => setSchool(i, { start_year: num(e.target.value) })} />
              <Input aria-label={`School ${i + 1} end year`} placeholder="To (YYYY)" inputMode="numeric" value={s.end_year ?? ""} onChange={(e) => setSchool(i, { end_year: num(e.target.value) })} />
            </div>
            <Button type="button" variant="ghost" size="sm" className="justify-self-end sm:col-span-2" aria-label={`Remove school ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, education: d.education.filter((_, k) => k !== i) }))}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          </fieldset>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setDraft((d) => ({ ...d, education: [...d.education, NEW_SCHOOL] }))}>
          <Plus className="h-4 w-4" /> Add a school
        </Button>
      </section>

      <label className="flex flex-col gap-1 text-sm font-semibold">
        Skills <span className="text-xs font-normal text-muted-foreground">One per line</span>
        <Textarea rows={5} aria-label="Skills" value={skills} onChange={(e) => setSkills(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Certifications <span className="text-xs font-normal text-muted-foreground">One per line</span>
        <Textarea rows={3} aria-label="Certifications" value={certs} onChange={(e) => setCerts(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Websites <span className="text-xs font-normal text-muted-foreground">One per line (LinkedIn, GitHub, portfolio)</span>
        <Textarea rows={3} aria-label="Websites" value={sites} onChange={(e) => setSites(e.target.value)} />
      </label>

      {(save.isError || reread.isError) && (
        <p className="text-sm text-destructive">
          {save.isError ? "Couldn't save that. Check the dates and links, then try again." : "Couldn't read the résumé. Try again later."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? "Saved" : "Save details"}
        </Button>
        <Button type="button" variant="outline" disabled={reread.isPending} onClick={() => reread.mutate()}>
          {reread.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Read my résumé
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Read my résumé replaces what's above with a fresh reading of the file.</p>
    </div>
  );
}
