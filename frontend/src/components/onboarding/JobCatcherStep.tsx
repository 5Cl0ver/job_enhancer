import { Check, ExternalLink, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareJobCatcherCard } from "@/components/jobcatcher/ShareCard";
import { useIsPhone } from "@/hooks/useIsPhone";
import { useOnboarding } from "@/hooks/useOnboarding";

/**
 * Welcome step 2: what Job Catcher is, and where to get it. While this step is
 * open it checks every 5 seconds, so "Connected ✓" shows up by itself when
 * Job Catcher signs in on this account.
 */
export function JobCatcherStep({ onNext }: { onNext: () => void }) {
  const phone = useIsPhone();
  const { data } = useOnboarding(5000);
  const connected = data?.items.find((i) => i.key === "job_catcher")?.done ?? false;

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 text-sm">
        <Puzzle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        Job Catcher sits in Chrome on your computer. It saves jobs from any site and fills job
        applications for you.
      </p>
      {connected ? (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-green-600/10 p-3 text-sm font-medium text-green-700 dark:text-green-300">
          <Check className="h-4 w-4" aria-hidden /> Connected ✓
        </p>
      ) : phone ? (
        <ShareJobCatcherCard />
      ) : (
        <Button asChild size="lg" className="gap-2 self-start">
          <a href="/job-catcher" target="_blank" rel="noopener">
            Get Job Catcher <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </Button>
      )}
      <Button variant={connected ? "default" : "ghost"} className="self-start" onClick={onNext}>
        {connected ? "Next" : "I'll do it later"}
      </Button>
    </div>
  );
}
