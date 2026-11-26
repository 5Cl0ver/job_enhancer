// Job Catcher's side panel: what you're doing on the tab beside it comes first
// (This page), everything else is one tap away in the bottom bar.
import * as React from "react";
import { BriefcaseBusiness, Download, ExternalLink, PenLine, ScanSearch, Settings as SettingsIcon } from "lucide-react";
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

const DOWNLOAD_URL = "https://github.com/5Cl0ver/job_enhancer/releases/latest/download/job-catcher.zip";

/**
 * Never out of date (spec 034): Job Catcher is a zip install, so Chrome can't
 * update it. When a newer one is out this card sits on top of every view:
 * Download, and How (three short steps). You stay signed in.
 */
export function UpdateCard({ version, latest }: { version: string; latest: string }) {
  const [how, setHow] = React.useState(false);
  return (
    <section
      role="status"
      aria-label="Update Job Catcher"
      data-testid="update-banner"
      className="flex flex-col gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm"
    >
      <div className="flex items-start gap-2">
        <Download className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Update Job Catcher</p>
          <p className="text-xs text-muted-foreground">
            {version ? `You have ${version}, the newest is ${latest}.` : `The newest is ${latest}.`} Takes 1 minute.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={() => chrome.tabs.create({ url: DOWNLOAD_URL }).catch(() => {})}>
          <Download />
          Download
        </Button>
        <Button size="sm" variant="outline" aria-expanded={how} onClick={() => setHow((v) => !v)}>
          How
        </Button>
      </div>
      {how && (
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-xs">
          <li>Unzip the download into your Job Catcher folder, replacing the files.</li>
          <li>
            Open{" "}
            <button
              type="button"
              className="cursor-pointer font-medium text-primary underline underline-offset-2"
              onClick={() => chrome.tabs.create({ url: "chrome://extensions" }).catch(() => {})}
            >
              chrome://extensions
            </button>
            .
          </li>
          <li>Press ↻ on Job Catcher. You stay signed in.</li>
        </ol>
      )}
    </section>
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
      {auth.latest && <UpdateCard version={auth.version || ""} latest={auth.latest} />}

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
