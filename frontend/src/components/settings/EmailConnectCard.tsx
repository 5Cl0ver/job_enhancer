/**
 * "Connect Email" — the Settings card for email auto-status.
 *
 * Flow: type your email → we detect your provider and show the exact
 * app-password steps → connect (password encrypted at rest) → scan the inbox →
 * review what it found on the Email Updates page (/email-updates). Cards move by
 * themselves only for emails that name the job exactly (switchable here); every
 * other move waits for your click, and any move can be undone. Email Updates
 * shows the same inbox controls at its top (InboxBar).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Loader2, Mail, RefreshCw } from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  useConnectEmail,
  useDetectedEvents,
  useDisconnectEmail,
  useEmailAccount,
  useEmailSettings,
  useFullScan,
  type EmailAccount,
  type FullScan,
} from "@/hooks/useEmailAccount";
import { group } from "@/lib/emailUpdates";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// Per-provider setup guidance. Detection runs in the browser (by email domain)
// so the right steps appear instantly as you type — no backend round-trip.
interface Guide {
  key: string;
  label: string;
  domains: string[];
  steps: string;
  link?: string;
  linkText?: string;
  needsHost?: boolean; // show IMAP host/port fields (Proton / unknown hosts)
}

const PROVIDERS: Guide[] = [
  {
    key: "yahoo",
    label: "Yahoo Mail",
    domains: ["yahoo.com", "ymail.com", "rocketmail.com"],
    steps:
      "Yahoo → Account Security → Generate app password (2-step verification must be on). Name it “Job Enhancer” and paste the 16-character code below.",
    link: "https://login.yahoo.com/account/security",
    linkText: "Open Yahoo Account Security",
  },
  {
    key: "gmail",
    label: "Gmail",
    domains: ["gmail.com", "googlemail.com"],
    steps:
      "One-click Google sign-in is coming soon. For now: turn on 2-Step Verification, then create an App Password (pick “Mail”) and paste the 16-character code below.",
    link: "https://myaccount.google.com/apppasswords",
    linkText: "Create a Google App Password",
  },
  {
    key: "outlook",
    label: "Outlook / Hotmail",
    domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"],
    steps:
      "One-click Microsoft sign-in is coming soon. For now: turn on two-step verification, create an app password in your Microsoft account security settings, and paste it below.",
    link: "https://account.live.com/proofs/AppPassword",
    linkText: "Create a Microsoft App Password",
  },
  {
    key: "icloud",
    label: "iCloud Mail",
    domains: ["icloud.com", "me.com", "mac.com"],
    steps:
      "Apple ID → Sign-In and Security → App-Specific Passwords → generate one, then paste it below.",
    link: "https://appleid.apple.com",
    linkText: "Open Apple ID",
  },
  {
    key: "aol",
    label: "AOL Mail",
    domains: ["aol.com"],
    steps:
      "AOL → Account Security → Generate app password, then paste the code below.",
    link: "https://login.aol.com/account/security",
    linkText: "Open AOL Account Security",
  },
  {
    key: "proton",
    label: "Proton Mail",
    domains: ["proton.me", "protonmail.com", "pm.me"],
    steps:
      "Proton has no direct IMAP access. Auto-forward job emails to an inbox we can read, or run Proton Bridge and enter its IMAP host below.",
    needsHost: true,
  },
];

const GENERIC: Guide = {
  key: "generic",
  label: "Other (IMAP)",
  domains: [],
  steps:
    "Create an app password in your email provider’s security settings, then enter your IMAP host, port, and the password below.",
  needsHost: true,
};

/** Detect the provider guide from an email address, entirely client-side. */
function detectGuide(email: string): Guide | null {
  const at = email.indexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain.includes(".")) return null;
  return PROVIDERS.find((p) => p.domains.includes(domain)) ?? GENERIC;
}

export function EmailConnectCard() {
  const { data: account, isLoading } = useEmailAccount();
  const [reconnecting, setReconnecting] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" />
          Connect Email <Badge variant="secondary">Auto-status</Badge>
        </CardTitle>
        <CardDescription>
          Let Job Enhancer read your inbox to spot application updates and move
          your tracker cards for you. Read-only: cards move by themselves only when an
          email names the job exactly, everything else waits for your click, and
          every move can be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : account && !reconnecting ? (
          <ConnectedView
            account={account}
            onReconnect={() => setReconnecting(true)}
          />
        ) : (
          <ConnectForm
            initialEmail={account?.email_address ?? ""}
            onDone={() => setReconnecting(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ConnectForm({
  initialEmail,
  onDone,
}: {
  initialEmail: string;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const connect = useConnectEmail();

  const guide = detectGuide(email);
  const needsHost = guide?.needsHost ?? false;

  const handleConnect = () => {
    connect.mutate(
      {
        email_address: email.trim(),
        app_password: password.trim(),
        imap_host: needsHost && host.trim() ? host.trim() : undefined,
        imap_port: port ? Number(port) : undefined,
      },
      { onSuccess: onDone },
    );
  };

  const canConnect =
    /.+@.+\..+/.test(email) &&
    password.trim().length > 0 &&
    (!needsHost || host.trim().length > 0) &&
    !connect.isPending;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="email-addr">Email address</Label>
        <Input
          id="email-addr"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@yahoo.com"
          autoComplete="email"
          spellCheck={false}
        />
      </div>

      {guide ? (
        <Alert>
          <AlertDescription className="space-y-1.5 text-xs">
            <div>
              <strong>{guide.label}</strong> — {guide.steps}
            </div>
            {guide.link && (
              <a
                href={guide.link}
                target="_blank"
                rel="noreferrer"
                className="inline-block font-medium text-primary underline"
              >
                {guide.linkText} ↗
              </a>
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-xs text-muted-foreground">
          Works with <strong>Yahoo</strong>, <strong>Gmail</strong>,{" "}
          <strong>Outlook/Hotmail</strong>, <strong>iCloud</strong>,{" "}
          <strong>AOL</strong> — or any IMAP host. Type your email above and the
          exact setup steps for your provider appear here.
        </p>
      )}

      {needsHost && (
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="imap-host">IMAP host</Label>
            <Input
              id="imap-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="imap.example.com"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imap-port">Port</Label>
            <Input
              id="imap-port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="993"
              inputMode="numeric"
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="app-pw">App password</Label>
        <Input
          id="app-pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="16-character app password"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Stored encrypted. Use a revocable app password — never your main
          password.
        </p>
      </div>

      {connect.isError && (
        <p className="text-xs text-destructive">
          {connect.error instanceof ApiError
            ? connect.error.message
            : "Couldn’t connect. Check the address and app password."}
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={handleConnect} disabled={!canConnect} className="gap-1.5">
          {connect.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Connect
        </Button>
        {initialEmail && (
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function ConnectedView({
  account,
  onReconnect,
}: {
  account: EmailAccount;
  onReconnect: () => void;
}) {
  const scan = useFullScan();
  const disconnect = useDisconnectEmail();
  const lastScan = account.last_scan_at
    ? new Date(account.last_scan_at).toLocaleString()
    : "never";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {account.email_address}
            </span>
            {account.status === "error" ? (
              <Badge variant="destructive">Reconnect needed</Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <Check className="h-3 w-3" /> Connected
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Last scan: {lastScan}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <ScanButton scan={scan} size="sm" />
        </div>
      </div>

      {account.status === "error" && account.last_error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            {account.last_error}{" "}
            <button className="font-medium underline" onClick={onReconnect}>
              Reconnect
            </button>
          </AlertDescription>
        </Alert>
      )}

      <ScanStatus scan={scan} />

      <AutoMoveSwitch account={account} />

      <EmailUpdatesLink />

      <div className="flex justify-end border-t pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
          className="text-muted-foreground"
        >
          Disconnect inbox
        </Button>
      </div>
    </div>
  );
}

function ScanButton({ scan, size }: { scan: FullScan & { run: () => void }; size?: "sm" }) {
  return (
    <Button size={size} onClick={scan.run} disabled={scan.running} className="gap-1.5">
      {scan.running ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="h-4 w-4" aria-hidden />
      )}
      {scan.running ? "Scanning…" : "Scan inbox"}
    </Button>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What the scan is doing now, or what it found — in plain words. */
function ScanStatus({ scan }: { scan: FullScan }) {
  if (scan.running)
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        Reading your inbox… {plural(scan.read, "email")} read
        {scan.found ? `, ${plural(scan.found, "update")} found` : ""} so far. A big inbox
        takes a few minutes; you can keep using the page.
      </p>
    );
  if (scan.error)
    return (
      <p className="text-xs text-destructive" aria-live="polite">
        {scan.error}
      </p>
    );
  if (!scan.passes) return null;
  return (
    <div className="rounded-md border bg-muted/30 p-2.5 text-xs" aria-live="polite">
      <span className="font-medium">
        {scan.found === 0
          ? "No new updates."
          : `Found ${plural(scan.found, "new update")}` +
            (scan.moved ? `, and moved ${plural(scan.moved, "card")} for you.` : ".")}
      </span>{" "}
      <span className="text-muted-foreground">
        {scan.done
          ? `Read ${plural(scan.read, "email")} from the last ${scan.windowDays} days — your inbox is up to date.`
          : `Read ${plural(scan.read, "email")} so far. There's more — tap Scan inbox again to keep going.`}
      </span>
    </div>
  );
}

/** The inbox controls at the top of Email updates: scan the whole inbox, when
 * it last checked, and whether cards move by themselves. Not connected yet:
 * the full connect card. */
export function InboxBar() {
  const { data: account, isLoading } = useEmailAccount();
  const scan = useFullScan();
  if (isLoading) return null;
  if (!account)
    return (
      <div className="mb-8">
        <EmailConnectCard />
      </div>
    );
  const last = account.last_scan_at
    ? new Date(account.last_scan_at).toLocaleString()
    : "never";
  return (
    <section className="mb-8 space-y-3 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{account.email_address}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Last checked {last} ·{" "}
            <Link to="/settings" className="underline underline-offset-2">
              Email settings
            </Link>
          </p>
        </div>
        <ScanButton scan={scan} />
      </div>
      {account.status === "error" && (
        <p className="text-xs text-destructive">
          {account.last_error || "Your inbox needs reconnecting."}{" "}
          <Link to="/settings" className="font-medium underline">
            Reconnect
          </Link>
        </p>
      )}
      <ScanStatus scan={scan} />
      <AutoMoveSwitch account={account} />
    </section>
  );
}

/** On: an email that names the job exactly moves its card by itself. */
function AutoMoveSwitch({ account }: { account: EmailAccount }) {
  const settings = useEmailSettings();
  const on = account.auto_move ?? true;
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-3">
      <span className="min-w-0">
        <Label htmlFor="auto-move" className="text-sm font-medium">
          Move cards automatically
        </Label>
        <span className="block text-xs text-muted-foreground">
          When an email names the job exactly, its card moves by itself. You can undo any move
          on Email updates. Off: every update waits for your click.
        </span>
        {settings.isError && (
          <span className="block text-xs text-destructive">
            Couldn't save that. Try again.
          </span>
        )}
      </span>
      <Switch
        id="auto-move"
        checked={on}
        disabled={settings.isPending}
        onCheckedChange={(checked) => settings.mutate({ auto_move: checked })}
      />
    </div>
  );
}

/** Where detected updates are reviewed now: one link with the counts. */
function EmailUpdatesLink() {
  const { data: events } = useDetectedEvents();
  const g = group(events ?? []);
  const waiting = g.questions.length + g.important.length;
  const moved = g.moved.length;
  return (
    <Link
      to="/email-updates"
      className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm hover:bg-muted/40"
    >
      <span>
        <span className="font-medium">Email updates</span>
        <span className="block text-xs text-muted-foreground">
          {(moved ? `${moved} moved for you · ` : "") +
            (waiting === 0
              ? "Nothing waiting for you."
              : `${waiting} update${waiting === 1 ? "" : "s"} waiting`) +
              (g.questions.length ? ` · ${g.questions.length} need an answer` : "") +
              (g.confirmations.length
                ? ` · ${g.confirmations.length} confirmation${g.confirmations.length === 1 ? "" : "s"}`
                : "")}
        </span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden />
    </Link>
  );
}
