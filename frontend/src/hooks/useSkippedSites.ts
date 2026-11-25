/**
 * TanStack Query hooks for Sites to skip (spec 024): the sites the user never
 * wants jobs from. Claude Scout leaves them out and Apply with Claude never
 * applies through them; the server does the checking.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";

export interface SkippedSite {
  id: string;
  host: string;
  created_at: string;
}

export interface SiteSuggestion {
  host: string;
  /** How many of the user's Scout finds were on it. */
  finds: number;
}

export interface SiteAdded {
  id: string;
  host: string;
  /** It (or a site it's part of) was on the list already. */
  already: boolean;
}

/** A site Claude Scout searches: the server asks before skipping it (409). */
export class NeedsConfirm extends Error {
  constructor(public why: string) {
    super(why);
  }
}

const KEY = ["skipped-sites"];

/**
 * Application systems many companies post on (Greenhouse, Workday…): skipping
 * one would skip every company on it, so the server refuses them. The same
 * list as `APPLICATION_SYSTEMS` in backend/app/services/skipped_sites.py.
 */
export const APPLICATION_SYSTEMS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "smartrecruiters.com",
  "myworkdayjobs.com",
  "myworkdaysite.com",
  "icims.com",
  "jobvite.com",
  "bamboohr.com",
  "breezy.hr",
  "taleo.net",
  "recruitee.com",
  "applytojob.com",
  "teamtailor.com",
];

/**
 * A link's own site, the way the server keeps it: lowercase, no "www.",
 * international names in their xn-- form (as `URL` gives them).
 */
export function siteOf(url: string | null | undefined): string | null {
  try {
    const u = new URL(url ?? "");
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/\.$/, "").replace(/^(?:www\.)+/, "") || null;
  } catch {
    return null;
  }
}

/** A site on an application system many companies use: never skippable. */
export function onApplicationSystem(host: string): boolean {
  return APPLICATION_SYSTEMS.some((s) => onSite(host, s));
}

/** The host is the site itself or one of its sub-sites (never a look-alike). */
export function onSite(host: string, site: string): boolean {
  return host === site || host.endsWith(`.${site}`);
}

export function useSkippedSites() {
  return useQuery<SkippedSite[]>({
    queryKey: KEY,
    queryFn: () => api.get<SkippedSite[]>("/v1/skipped-sites"),
  });
}

export function useSiteSuggestions() {
  return useQuery<SiteSuggestion[]>({
    queryKey: [...KEY, "suggestions"],
    queryFn: () => api.get<SiteSuggestion[]>("/v1/skipped-sites/suggestions"),
  });
}

/** Throws `NeedsConfirm` with the server's reason for a site Scout searches. */
export function useAddSkippedSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ site, confirm = false }: { site: string; confirm?: boolean }) => {
      try {
        return await api.post<SiteAdded>("/v1/skipped-sites", { site, confirm });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          let why = "Claude Scout searches this site. Skip it anyway?";
          try {
            const detail = (JSON.parse(err.message) as { detail?: { why?: unknown } }).detail;
            if (typeof detail?.why === "string") why = detail.why;
          } catch {
            // keep the plain fallback
          }
          throw new NeedsConfirm(why);
        }
        throw err;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRemoveSkippedSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/skipped-sites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
