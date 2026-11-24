/**
 * TanStack Query hooks for a résumé's details (spec 020): the jobs, schools,
 * skills, certifications and websites read from the file — no AI — which Job
 * Catcher fills "enter your résumé again" pages from. Editable in the app,
 * and a saved job can have its own résumé.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface WorkEntry {
  title: string;
  company: string;
  location: string;
  start_month: number | null;
  start_year: number | null;
  end_month: number | null;
  end_year: number | null;
  current: boolean;
  description: string;
}

export interface SchoolEntry {
  school: string;
  degree: string;
  field_of_study: string;
  start_year: number | null;
  end_year: number | null;
}

export interface ResumeDetails {
  work: WorkEntry[];
  education: SchoolEntry[];
  skills: string[];
  certifications: string[];
  websites: string[];
}

export interface ResumeDetailsOut extends ResumeDetails {
  resume_id: string;
  filename: string;
  /** Read from the file (or saved by the user) at least once. */
  read: boolean;
}

const key = (id: string) => ["resume-details", id];

export function useResumeDetails(resumeId: string | null | undefined) {
  return useQuery<ResumeDetailsOut>({
    queryKey: key(resumeId || ""),
    queryFn: () => api.get<ResumeDetailsOut>(`/v1/autofill/resumes/${encodeURIComponent(resumeId!)}/details`),
    enabled: !!resumeId,
    staleTime: 60_000,
  });
}

export function useSaveResumeDetails(resumeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (details: ResumeDetails) =>
      api.put<ResumeDetailsOut>(`/v1/autofill/resumes/${encodeURIComponent(resumeId)}/details`, details),
    onSuccess: (out) => qc.setQueryData(key(resumeId), out),
  });
}

export function useReadResume(resumeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ResumeDetailsOut>(`/v1/autofill/resumes/${encodeURIComponent(resumeId)}/read`, undefined),
    onSuccess: (out) => qc.setQueryData(key(resumeId), out),
  });
}

/** The résumé Job Catcher uses for one saved job; null = the usual one. */
export function useSetJobResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ savedJobId, resumeId }: { savedJobId: string; resumeId: string | null }) =>
      api.put(`/v1/saved-jobs/${encodeURIComponent(savedJobId)}/resume`, { resume_id: resumeId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-jobs"] }),
  });
}
