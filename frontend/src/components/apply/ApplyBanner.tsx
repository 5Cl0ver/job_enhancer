import { Link, useLocation } from "react-router-dom";
import { Hand } from "lucide-react";
import { useOpenApply } from "@/hooks/useApply";
import { bannerLine, needsYou } from "@/lib/apply";

/**
 * A thin bar on every app screen while Claude is waiting for the user: its
 * questions, a sign-in, or the review. Hidden on that application's own page.
 */
export function ApplyBanner() {
  const { data: run } = useOpenApply();
  const { pathname } = useLocation();
  if (!run || !needsYou(run) || pathname === `/apply/${run.id}`) return null;
  return (
    <Link
      to={`/apply/${run.id}`}
      className="flex items-center gap-2 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-foreground hover:bg-primary/15"
    >
      <Hand className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 truncate">{bannerLine(run)}</span>
      <span className="ml-auto shrink-0 text-primary">Open</span>
    </Link>
  );
}
