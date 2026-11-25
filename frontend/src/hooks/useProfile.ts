import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: "user" | "admin";
  follow_up_days: number;
  /** Shared Claude Project link — synced with the browser extension. */
  claude_project_url: string | null;
  /** Look over Claude's résumé before it's used (spec 025). */
  review_resumes?: boolean;
  created_at: string;
}

/** The signed-in user's profile from the backend (includes role). */
export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () => api.get<UserProfile>("/v1/users/me"),
    staleTime: 5 * 60 * 1000,
  });
}

/** Update account settings (name, follow-up days, Claude Project link). */
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      data: Partial<Pick<UserProfile, "name" | "follow_up_days" | "claude_project_url" | "review_resumes">>,
    ) =>
      api.patch<UserProfile>("/v1/users/me", data),
    onSuccess: (updated) => qc.setQueryData(["profile"], updated),
  });
}
