import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AdminUserRow, Allowances, UserProfile } from "@/types/api";

interface ServiceStatus {
  name: string;
  // off: no key set, so it's not set up (never pinged, never reported).
  status: "healthy" | "degraded" | "down" | "off";
  latency_ms: number | null;
  detail: string | null;
}

interface DailySignup {
  date: string;
  count: number;
}

interface PlatformStats {
  total_users: number;
  active_7d: number;
  active_30d: number;
  new_7d: number;
  signups_by_day: DailySignup[];
}

export function useAdminStats() {
  return useQuery<PlatformStats>({
    queryKey: ["admin", "stats"],
    queryFn: () => api.get<PlatformStats>("/v1/admin/stats"),
    staleTime: 2 * 60_000,
  });
}

export function useServiceHealth() {
  return useQuery<ServiceStatus[]>({
    queryKey: ["admin", "health"],
    queryFn: () => api.get<ServiceStatus[]>("/v1/admin/health"),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useAdminUsers(page: number = 1) {
  return useQuery<AdminUserRow[]>({
    queryKey: ["admin", "users", page],
    queryFn: () => api.get<AdminUserRow[]>(`/v1/admin/users?page=${page}&page_size=25`),
    staleTime: 2 * 60_000,
  });
}

/** Promote a user to admin or demote back to a regular user. */
export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "user" | "admin" }) =>
      api.patch<UserProfile>(`/v1/admin/users/${userId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

/** Soft-delete (remove) a user account — subject to the 30-day purge grace. */
export function useRemoveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete(`/v1/admin/users/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
  });
}

/** The daily free allowances and the shared live-search month (spec 019). */
export function useAllowances() {
  return useQuery<Allowances>({
    queryKey: ["admin", "allowances"],
    queryFn: () => api.get<Allowances>("/v1/admin/allowances"),
  });
}

export function useSaveAllowances() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<Allowances>) => api.put<Allowances>("/v1/admin/allowances", values),
    onSuccess: (saved) => qc.setQueryData(["admin", "allowances"], saved),
  });
}
