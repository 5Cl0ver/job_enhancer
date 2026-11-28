// The saved job an Apply press suggests for the tab beside the panel (spec
// 040, src/background/tabJobs.js): only a suggestion. The Fill button
// offers that job's résumé and cover letter for one fill of this page; the
// first application page asks once whether it is that job's (for its link).
import * as React from "react";
import { send } from "@/lib/chrome";
import { usePanel } from "@/lib/store";

export interface JobSuggestion {
  jobId: string;
  title: string;
  company: string;
  /** Ask "Is this the application for <job>?" on this page (once). */
  ask: boolean;
  /** The page it's about (an answer for another page is refused). */
  page: string;
}

export function useJobSuggestion(): { suggestion: JobSuggestion | null; refresh: () => void } {
  const { tab } = usePanel();
  const [suggestion, setSuggestion] = React.useState<JobSuggestion | null>(null);
  const tabId = tab.id;
  const url = tab.url;
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    const load = async () => {
      if (tabId == null) return setSuggestion(null);
      const r = (await send({ type: "getJobSuggestion", tabId })) as {
        job?: { id: string; title: string; company: string } | null;
        ask?: boolean;
        page?: string;
      } | null;
      if (!live) return;
      setSuggestion(r?.job ? { jobId: r.job.id, title: r.job.title, company: r.job.company, ask: !!r.ask, page: r.page || "" } : null);
    };
    load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && changes.je_tab_press) load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      live = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [tabId, url, n]);
  return { suggestion, refresh: () => setN((x) => x + 1) };
}

/** "IT Analyst at Acme". */
export const jobName = (s: { title: string; company: string }) => (s.company ? `${s.title} at ${s.company}` : s.title);
