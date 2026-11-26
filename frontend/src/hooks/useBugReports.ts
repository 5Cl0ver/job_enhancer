/**
 * TanStack Query hooks for Bugs & ideas (spec 032), the owner's inbox.
 * Every change refreshes the lists, the open report and the Admin badge.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  BugContext,
  BugDetail,
  BugEvent,
  BugFilters,
  BugList,
  BugSection,
  BugSeverity,
  BugStatus,
  BugType,
} from "@/lib/bugs";

const KEY = ["admin", "bugs"] as const;

export function bugListPath(f: BugFilters, limit = 200): string {
  const q = new URLSearchParams({
    type: f.type,
    status: f.status,
    limit: String(limit),
  });
  if (f.section) q.set("section", f.section);
  if (f.severity && f.type === "bug") q.set("severity", f.severity);
  if (f.source) q.set("source", f.source);
  if (f.came_back) q.set("came_back", "true");
  if (f.needs_check) q.set("needs_check", "true");
  if (f.q?.trim()) q.set("q", f.q.trim());
  return `/v1/admin/bugs?${q}`;
}

export function useBugList(filters: BugFilters, enabled = true) {
  return useQuery<BugList>({
    queryKey: [...KEY, "list", filters],
    queryFn: () => api.get<BugList>(bugListPath(filters)),
    staleTime: 30_000,
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useBugDetail(id: string | null) {
  return useQuery<BugDetail>({
    queryKey: [...KEY, "detail", id],
    queryFn: () => api.get<BugDetail>(`/v1/admin/bugs/${id}`),
    enabled: !!id,
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: KEY });
    // The Admin badge counts new bugs.
    qc.invalidateQueries({ queryKey: ["email-events", "attention"] });
  };
}

export interface NewBug {
  type: BugType;
  title: string;
  section: BugSection;
  severity?: BugSeverity;
  actual: string;
  expected: string;
  steps: string[];
  place?: string;
  context: BugContext;
}

export function useAddBug() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (bug: NewBug) =>
      api.post<{ report: BugDetail }>("/v1/admin/bugs", bug),
    onSuccess: refresh,
  });
}

export type BugChange = Partial<{
  type: BugType;
  title: string;
  section: BugSection;
  severity: BugSeverity;
  status: BugStatus;
  fixed_in: string;
  pinned: boolean;
  checked: boolean;
  actual: string;
  expected: string;
  steps: string[];
  place: string;
  box: string;
}>;

export function useUpdateBug() {
  const qc = useQueryClient();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, ...change }: BugChange & { id: string }) =>
      api.patch<BugDetail>(`/v1/admin/bugs/${id}`, change),
    onSuccess: (saved) => {
      qc.setQueryData([...KEY, "detail", saved.id], saved);
      refresh();
    },
  });
}

export function useBulkBugs() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: {
      ids: string[];
      status?: BugStatus;
      section?: BugSection;
    }) => api.post<{ changed: number }>("/v1/admin/bugs/bulk", body),
    onSuccess: refresh,
  });
}

export function useDeleteBug() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/admin/bugs/${id}`),
    onSuccess: refresh,
  });
}

export function useAddBugNote() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api.post<BugEvent>(`/v1/admin/bugs/${id}/notes`, { text }),
    onSuccess: refresh,
  });
}

export function useLinkBug() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, otherId }: { id: string; otherId: string }) =>
      api.post(`/v1/admin/bugs/${id}/links`, { other_id: otherId }),
    onSuccess: refresh,
  });
}

export function useUnlinkBug() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, otherId }: { id: string; otherId: string }) =>
      api.delete(`/v1/admin/bugs/${id}/links/${otherId}`),
    onSuccess: refresh,
  });
}

/** The same problem: `id` goes into `intoId`, undone with a split. */
export function useMergeBug() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, intoId }: { id: string; intoId: string }) =>
      api.post<BugDetail>(`/v1/admin/bugs/${id}/merge`, { into_id: intoId }),
    onSuccess: refresh,
  });
}

export function useSplitBug() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, eventId }: { id: string; eventId: string }) =>
      api.post<BugDetail>(`/v1/admin/bugs/${id}/split/${eventId}`, {}),
    onSuccess: refresh,
  });
}
