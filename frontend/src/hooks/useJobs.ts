/**
 * TanStack Query hooks for job search and individual job lookup.
 */

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { JobListing, JobSearchResponse } from "@/types/api";

export interface JobSearchParams {
  q: string;
  location?: string;
  remote_only?: boolean;
  salary_min?: number;
  job_type?: string;
  page?: number;
  page_size?: number;
}

function buildSearchUrl(params: JobSearchParams): string {
  const qs = new URLSearchParams();
  qs.set("q", params.q);
  if (params.location) qs.set("location", params.location);
  if (params.remote_only) qs.set("remote_only", "true");
  if (params.salary_min != null) qs.set("salary_min", String(params.salary_min));
  if (params.job_type) qs.set("job_type", params.job_type);
  qs.set("page", String(params.page ?? 1));
  qs.set("page_size", String(params.page_size ?? 20));
  return `/v1/jobs/?${qs.toString()}`;
}

/** Search jobs — paginated, keeps previous data while loading next page. */
export function useJobSearch(params: JobSearchParams, enabled = true) {
  return useQuery<JobSearchResponse>({
    queryKey: ["jobs", "search", params],
    queryFn: () => api.get<JobSearchResponse>(buildSearchUrl(params)),
    enabled: enabled && params.q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000, // 1 min — job listings don't change that fast
  });
}

/** Fetch a single job by ID. */
export function useJob(jobId: string | null) {
  return useQuery<JobListing>({
    queryKey: ["jobs", jobId],
    queryFn: () => api.get<JobListing>(`/v1/jobs/${jobId}`),
    enabled: !!jobId,
    staleTime: 5 * 60_000, // 5 min
  });
}
