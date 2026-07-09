import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface WeeklyActivity {
  week_start: string;
  count: number;
}

interface AnalyticsSummary {
  total_saved: number;
  total_applied: number;
  total_interviews: number;
  response_rate: number;
  weekly_activity: WeeklyActivity[];
}

export function useAnalyticsSummary() {
  return useQuery<AnalyticsSummary>({
    queryKey: ["analytics", "summary"],
    queryFn: () => api.get<AnalyticsSummary>("/api/v1/analytics/summary"),
    staleTime: 5 * 60_000,
  });
}
