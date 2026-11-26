import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Download, X } from "lucide-react";
import { useJobCatcherInstalls, useJobCatcherRelease } from "@/hooks/useJobCatcher";
import { outdatedJobCatcher } from "@/lib/jobCatcher";

const HIDE_KEY = "je_jc_update_hidden";
const DAY_MS = 24 * 3600 * 1000;

/** Hidden for a day for this release (a newer release shows again). */
function hiddenFor(latest: string): boolean {
  try {
    const held = JSON.parse(localStorage.getItem(HIDE_KEY) || "null") as { latest?: string; until?: number } | null;
    return !!held && held.latest === latest && (held.until || 0) > Date.now();
  } catch {
    return false;
  }
}

function hideForADay(latest: string) {
  try {
    localStorage.setItem(HIDE_KEY, JSON.stringify({ latest, until: Date.now() + DAY_MS }));
  } catch {
    /* storage blocked: hidden for this visit only */
  }
}

/**
 * Never out of date (spec 034): on every app page, when the user's Job
 * Catcher (any computer seen in the last 30 days) is older than the newest
 * release. Job Catcher is a zip install, so Chrome can't update it by itself.
 * "How to update" goes to the Job Catcher page; "Hide for a day" hides it for
 * this release.
 */
export function UpdateBanner() {
  const { data: installs } = useJobCatcherInstalls();
  const { data: release } = useJobCatcherRelease();
  const { pathname } = useLocation();
  const [hidden, setHidden] = useState(false);
  const behind = outdatedJobCatcher(installs, release?.version);
  if (!behind || hidden || hiddenFor(behind.latest) || pathname.startsWith("/job-catcher")) return null;
  const where = behind.where ? `on ${behind.where}` : "on your computer";
  return (
    <div
      role="status"
      data-testid="jc-update-banner"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
    >
      <Download className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
      <span className="min-w-0 flex-1">
        Job Catcher {where} is out of date ({behind.version} → {behind.latest}). Update it so the latest fixes work.
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <Link to="/job-catcher#update" className="font-medium text-primary underline underline-offset-2">
          How to update
        </Link>
        <button
          type="button"
          onClick={() => {
            hideForADay(behind.latest);
            setHidden(true);
          }}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Hide for a day
        </button>
      </span>
    </div>
  );
}
