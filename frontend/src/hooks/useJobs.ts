/**
 * TanStack Query hooks for job search and individual job lookup.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { JobListing, JobSearchResponse } from "@/types/api";

export interface JobSearchParams {
  q: string;
  location?: string;
  remote_only?: boolean;
  salary_min?: number;
  salary_max?: number;
  experience?: string;
  job_type?: string;
  page?: number;
  page_size?: number;
  refresh?: boolean;
}

function buildSearchUrl(params: JobSearchParams): string {
  const qs = new URLSearchParams();
  qs.set("q", params.q);
  if (params.location) qs.set("location", params.location);
  if (params.remote_only) qs.set("remote_only", "true");
  if (params.salary_min != null) qs.set("salary_min", String(params.salary_min));
  if (params.salary_max != null) qs.set("salary_max", String(params.salary_max));
  if (params.experience) qs.set("experience", params.experience);
  if (params.job_type) qs.set("job_type", params.job_type);
  qs.set("page", String(params.page ?? 1));
  qs.set("page_size", String(params.page_size ?? 20));
  if (params.refresh) qs.set("refresh", "true");
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

/** Force a live fetch from external sources, then refresh the cached results. */
export function useRefreshSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: JobSearchParams) =>
      api.get<JobSearchResponse>(buildSearchUrl({ ...params, refresh: true })),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["jobs", "search"] }),
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
