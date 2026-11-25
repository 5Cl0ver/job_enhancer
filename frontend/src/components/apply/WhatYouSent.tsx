import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { useJobApplyRuns } from "@/hooks/useApply";

/**
 * On a job's page once Claude sent it (spec 022 User Story 8): when, and a
 * link to every page's photos and answers. Before an interview, this is what
 * you told them.
 */
export function WhatYouSent({ savedJobId }: { savedJobId: string }) {
  const { data: runs = [] } = useJobApplyRuns(savedJobId);
  const sent = runs.find((r) => r.status === "sent");
  if (!sent) return null;
  const when = new Date(sent.finished_at ?? sent.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-center gap-1.5 text-sm">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        Sent with Claude on {when}
      </p>
      <Link to={`/apply/${sent.id}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        What you sent
      </Link>
    </section>
  );
}
