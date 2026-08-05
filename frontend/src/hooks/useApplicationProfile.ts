/**
 * The "profile vault": the user's one-time application answers (contact,
 * links, work authorization, preferences). Filled in Settings; consumed by
 * the extension's ATS autofill.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface ApplicationProfile {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  authorized_to_work: boolean | null;
  requires_sponsorship: boolean | null;
  willing_to_relocate: boolean | null;
  desired_salary: number | null;
  notice_period: string | null;
}

export function useApplicationProfile() {
  return useQuery<ApplicationProfile>({
    queryKey: ["application-profile"],
    queryFn: () => api.get<ApplicationProfile>("/v1/users/me/application-profile"),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateApplicationProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ApplicationProfile>) =>
      api.put<ApplicationProfile>("/v1/users/me/application-profile", data),
    onSuccess: (profile) => qc.setQueryData(["application-profile"], profile),
  });
}

export interface ProfileFillResult {
  profile: ApplicationProfile;
  /** Which fields the resume filled (empty ones only). */
  filled: string[];
}

/** Fill empty vault fields from the uploaded resume (regex + LLM hybrid). */
export function useFillProfileFromResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ProfileFillResult>("/v1/users/me/application-profile/from-resume", {}),
    onSuccess: (result) => qc.setQueryData(["application-profile"], result.profile),
  });
}
