import { Eye, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resumeFile, useFileViewer } from "@/components/common/FileViewer";
import { useResumes } from "@/hooks/useAI";
import { useSetJobResume } from "@/hooks/useResumeDetails";
import { useSavedJobs } from "@/hooks/useSavedJobs";

/**
 * "Résumé for this job" (spec 020): the résumé Job Catcher uploads for this
 * job's application AND fills its job, school and skills sections from.
 * Empty = the résumé type's résumé, else your usual one.
 */
export function JobResumePicker({ jobListingId }: { jobListingId: string }) {
  const { data: saved } = useSavedJobs();
  const { data: all = [] } = useResumes({ withMade: true });
  const setResume = useSetJobResume();
  const { view, viewer } = useFileViewer();
  const job = saved?.find((sj) => sj.job_listing_id === jobListingId);
  const chosen =
    (job as { resume_id?: string | null } | undefined)?.resume_id ?? "";
  // Your own résumés, plus the one Claude made for THIS job (never another job's).
  const resumes = all.filter((r) => !r.document_id || r.id === chosen);
  if (!job || resumes.length < 2) return null;
  // What Job Catcher will upload: the one picked, else your usual (active) one.
  const shown =
    resumes.find((r) => r.id === chosen) ??
    all.find((r) => r.is_active && !r.document_id) ??
    null;
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">Résumé for this job</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Job Catcher uploads it and fills this application from it.
        </p>
        {setResume.isError && (
          <p className="text-xs text-destructive">
            Couldn't save that. Try again.
          </p>
        )}
      </div>
      <div className="flex w-full gap-2 sm:w-auto">
        <select
          aria-label="Résumé for this job"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm pointer-coarse:h-11 pointer-coarse:text-base sm:w-56 sm:flex-none"
          value={chosen}
          disabled={setResume.isPending}
          onChange={(e) =>
            setResume.mutate({
              savedJobId: job.id,
              resumeId: e.target.value || null,
            })
          }
        >
          <option value="">Your usual résumé</option>
          {resumes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.filename}
            </option>
          ))}
        </select>
        {shown && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0 gap-1.5 pointer-coarse:h-11"
            aria-label={`View ${shown.filename}`}
            onClick={() => view(resumeFile(shown.id, shown.filename))}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden /> View
          </Button>
        )}
      </div>
      {viewer}
    </section>
  );
}
