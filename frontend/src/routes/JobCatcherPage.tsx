import { Check, Download, Puzzle } from "lucide-react";
import { useIsPhone } from "@/hooks/useIsPhone";
import {
  useDisconnectJobCatcher,
  useJobCatcherConnections,
  useJobCatcherInstalls,
  useJobCatcherRelease,
  type JobCatcherConnection,
} from "@/hooks/useJobCatcher";
import { DOWNLOAD_URL, RECENT_MS, isOlder } from "@/lib/jobCatcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AddressArt,
  ConnectArt,
  DevModeArt,
  LoadUnpackedArt,
  PinArt,
  UnzipArt,
} from "@/components/jobcatcher/InstallArt";
import { CopyButton, ShareJobCatcherCard } from "@/components/jobcatcher/ShareCard";
import { InfoBubble } from "@/components/common/InfoBubble";

const STEPS = [
  { art: UnzipArt, text: "Unzip the download into a folder you'll keep, for example Documents › Job Catcher." },
  { art: AddressArt, text: "In Chrome, go to chrome://extensions.", copy: "chrome://extensions" },
  { art: DevModeArt, text: "Turn on Developer mode (top right)." },
  { art: LoadUnpackedArt, text: "Press Load unpacked and choose the Job Catcher folder." },
  { art: PinArt, text: "Pin it: press the puzzle piece, then the pin next to Job Catcher." },
  { art: ConnectArt, text: "Click Job Catcher, then Connect to Job Enhancer. Approve it here, and you're done." },
];

/**
 * Get Job Catcher (spec 019): download, a picture-led install guide, the
 * version, an update note, and the computers it's connected on. On a phone it
 * says Job Catcher is for a computer and offers to share the link.
 */
export default function JobCatcherPage() {
  const phone = useIsPhone();
  const release = useJobCatcherRelease();
  const connections = useJobCatcherConnections();
  const installs = useJobCatcherInstalls();
  const latest = release.data?.version ?? null;
  const live = connections.data ?? [];
  // Seen recently, by any sign-in (Connect or password), newest first.
  const seen = (installs.data ?? []).filter(
    (i) => Date.now() - new Date(i.last_seen_at).getTime() < RECENT_MS,
  );
  const connected = seen.length > 0 || live.length > 0;
  const newestVersion = seen[0]?.version ?? live.find((c) => c.version)?.version ?? null;
  const behind = seen.find((i) => isOlder(i.version, latest))?.version ?? null;

  return (
    <div className="container mx-auto flex max-w-2xl flex-col gap-3 md:gap-6 md:px-4 md:py-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Puzzle className="h-6 w-6 text-primary" /> Job Catcher <InfoBubble topic="jobCatcher" />
        </h1>
        <p className="text-sm text-muted-foreground">
          Job Catcher sits in Chrome on your computer. It saves jobs from any site and fills job
          applications for you.
        </p>
      </div>

      {latest && release.data?.notes && (
        <div role="note" data-testid="jc-whats-new" className="rounded-lg border bg-muted/40 p-3 text-sm">
          <span className="font-medium">What's new in {latest}:</span> {release.data.notes}
        </div>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-wrap items-center gap-2" data-testid="jc-status">
            {!connected ? (
              <Badge variant="secondary">Not installed yet</Badge>
            ) : behind ? (
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                Update available: you have {behind}
              </Badge>
            ) : (
              <Badge className="bg-green-600/15 text-green-700 dark:text-green-300">
                <Check className="mr-1 h-3 w-3" /> Connected{newestVersion ? ` (${newestVersion})` : ""}
              </Badge>
            )}
            {latest && <span className="text-sm text-muted-foreground">Latest version {latest}</span>}
          </div>
          {phone ? <ShareJobCatcherCard /> : (
            <Button asChild size="lg" className="gap-2 self-start">
              <a href={release.data?.download_url || DOWNLOAD_URL}>
                <Download className="h-4 w-4" /> Download Job Catcher (.zip)
              </a>
            </Button>
          )}
          {release.data?.sha256 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Check the download (optional)</summary>
              <p className="mt-1">
                The real file's SHA-256 is{" "}
                <code className="break-all font-mono">{release.data.sha256}</code>. On Windows:{" "}
                <code className="font-mono">certutil -hashfile job-catcher.zip SHA256</code>. On a Mac:{" "}
                <code className="font-mono">shasum -a 256 job-catcher.zip</code>.
              </p>
            </details>
          )}
        </CardContent>
      </Card>

      {!phone && (
        <Card>
          <CardHeader>
            <CardTitle>Install in 6 steps</CardTitle>
            <CardDescription>About 3 minutes. Nothing to type except one address.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-4 sm:grid-cols-2">
              {STEPS.map((s, i) => (
                <li key={i} className="flex flex-col gap-2 rounded-lg border p-3">
                  <s.art />
                  <p className="text-sm">
                    <span className="mr-1 font-bold text-primary">{i + 1}.</span>
                    {s.text}
                  </p>
                  {s.copy && <CopyButton text={s.copy} label="Copy address" />}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 pt-6 text-sm">
          <details>
            <summary className="cursor-pointer font-medium">About the "developer mode" message</summary>
            <p className="mt-2 text-muted-foreground">
              Chrome shows it for extensions that aren't in the Chrome Web Store yet. That's
              expected. Job Catcher only talks to Job Enhancer, and you can remove it any time from
              chrome://extensions.
            </p>
          </details>
          <div id="update">
            <p className="font-medium">Updating</p>
            <p className="text-muted-foreground">
              Download the new zip and unzip it into the same folder, replacing the files. Then
              press ↻ (reload) on Job Catcher in chrome://extensions. You stay signed in. Job
              Catcher checks for a new version every few hours and shows NEW on its icon when one
              is out.
            </p>
          </div>
          <div>
            <p className="font-medium">Works in</p>
            <p className="text-muted-foreground">
              Chrome, Edge and Brave on a computer. Phones can't run browser extensions.
            </p>
          </div>
        </CardContent>
      </Card>

      {live.length > 0 && <Connections rows={live} latest={latest} />}
    </div>
  );
}

function Connections({ rows, latest }: { rows: JobCatcherConnection[]; latest: string | null }) {
  const disconnect = useDisconnectJobCatcher();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected computers</CardTitle>
        <CardDescription>Disconnect one and its Job Catcher is signed out at once.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.browser || "Job Catcher"}</p>
                <p className="text-xs text-muted-foreground">
                  {c.version ? `Version ${c.version}` : "Version not known yet"}
                  {isOlder(c.version, latest) ? " · update available" : ""}
                  {c.last_used_at ? ` · last used ${new Date(c.last_used_at).toLocaleDateString()}` : ""}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate(c.id)}
                aria-label={`Disconnect ${c.browser || "Job Catcher"}`}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
