import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { UserProfile } from "@/types/api";

interface ServiceStatus {
  name: string;
  status: "healthy" | "degraded" | "down";
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
  return useQuery<UserProfile[]>({
    queryKey: ["admin", "users", page],
    queryFn: () => api.get<UserProfile[]>(`/v1/admin/users?page=${page}&page_size=25`),
    staleTime: 2 * 60_000,
  });
}
