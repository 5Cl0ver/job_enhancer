// Job Catcher's side panel: what you're doing on the tab beside it comes first
// (This page), everything else is one tap away in the bottom bar.
import * as React from "react";
import { BriefcaseBusiness, ExternalLink, PenLine, ScanSearch, Settings as SettingsIcon } from "lucide-react";
import { Button, Spinner } from "@/ui";
import { cn } from "@/lib/utils";
import { appUrl } from "@/lib/chrome";
import { usePageJob } from "@/lib/pageJob";
import { usePanel } from "@/lib/store";
import { SignIn } from "@/views/SignIn";
import { ThisPage } from "@/views/ThisPage";
import { MyJobs } from "@/views/MyJobs";
import { Write } from "@/views/Write";
import { Settings } from "@/views/Settings";

export type View = "page" | "jobs" | "write" | "settings";

const NAV: { view: View; label: string; Icon: typeof ScanSearch }[] = [
  { view: "page", label: "This page", Icon: ScanSearch },
  { view: "jobs", label: "My jobs", Icon: BriefcaseBusiness },
  { view: "write", label: "Write", Icon: PenLine },
  { view: "settings", label: "Settings", Icon: SettingsIcon },
];

export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm",
        className,
      )}
    >
      <BriefcaseBusiness className="size-4" />
    </span>
  );
}

export function App() {
  const { auth, tab } = usePanel();
  const { match } = usePageJob();
  const [view, setView] = React.useState<View>("page");
  // "Write for this job" from This page; otherwise the job the tab is about.
  const [writeFor, setWriteFor] = React.useState<string | null>(null);
  React.useEffect(() => setWriteFor(null), [tab.url]);
  const preferJob = writeFor || match?.job_listing_id || null;

  if (auth.state === "loading") return <Spinner label="Starting…" />;
  if (auth.state === "out") return <SignIn />;

  const openApp = () => chrome.tabs.create({ url: `${appUrl()}/saved` });

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        <Logo />
        <span className="font-semibold tracking-tight">Job Catcher</span>
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={openApp} title="Open Job Enhancer" aria-label="Open Job Enhancer">
          <ExternalLink />
        </Button>
      </header>

      {/* Every view stays mounted and is only hidden, so work in progress (a
          letter just written, a job being checked) survives switching views. */}
      <main className="flex-1 overflow-y-auto px-3 py-3">
        <div hidden={view !== "page"}>
          <ThisPage
            onWrite={(jobListingId) => {
              setWriteFor(jobListingId);
              setView("write");
            }}
          />
        </div>
        <div hidden={view !== "jobs"}>
          <MyJobs />
        </div>
        <div hidden={view !== "write"}>
          <Write preferJob={preferJob} />
        </div>
        <div hidden={view !== "settings"}>
          <Settings />
        </div>
      </main>

      <nav aria-label="Job Catcher" className="grid grid-cols-4 border-t bg-background">
        {NAV.map(({ view: v, label, Icon }) => (
          <button
            key={v}
            type="button"
            aria-current={view === v ? "page" : undefined}
            onClick={() => setView(v)}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              view === v ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-[18px]" aria-hidden />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
