/**
 * "Connect Email" — the Settings card for email auto-status.
 *
 * Flow: type your email → we detect your provider and show the exact
 * app-password steps → connect (password encrypted at rest) → scan the inbox →
 * review each detected update (approve moves the card, dismiss ignores it, and
 * an approved move can be undone). We never read or move anything without you
 * approving it first.
 */
import { useState } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  Undo2,
  X,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  useConnectEmail,
  useDetectedEvents,
  useDisconnectEmail,
  useEmailAccount,
  useReviewEvent,
  useScanInbox,
  type Considered,
  type DetectedEvent,
  type EmailAccount,
  type ScanResult,
} from "@/hooks/useEmailAccount";
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

const EVENT_LABELS: Record<DetectedEvent["event_type"], string> = {
  applied: "Application received",
  interview: "Interview",
  rejected: "Rejection",
  recruiter: "Recruiter reached out",
};

const EVENT_TONES: Record<DetectedEvent["event_type"], string> = {
  applied: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  interview: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rejected: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  recruiter: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

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
          your tracker cards for you. Read-only, review-first — nothing moves
          without your approval, and every move can be undone.
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
  const scan = useScanInbox();
  const disconnect = useDisconnectEmail();
  const [result, setResult] = useState<ScanResult | null>(null);

  const lastScan = account.last_scan_at
    ? new Date(account.last_scan_at).toLocaleString()
    : "never";

  const handleScan = () => {
    scan.mutate(undefined, { onSuccess: (r) => setResult(r) });
  };

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
          <Button
            size="sm"
            onClick={handleScan}
            disabled={scan.isPending}
            className="gap-1.5"
          >
            {scan.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Scan now
          </Button>
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

      {scan.isError && (
        <p className="text-xs text-destructive">
          {scan.error instanceof ApiError
            ? scan.error.message
            : "Scan failed."}
        </p>
      )}
      {result && !scan.isPending && (
        <p className="text-xs text-muted-foreground">
          {result.detected === 0
            ? "No new updates found."
            : `Found ${result.detected} update${result.detected === 1 ? "" : "s"} to review below.`}
        </p>
      )}

      <DetectedEventsList />

      {result && result.considered.length > 0 && (
        <ConsideredList items={result.considered} />
      )}

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

function DetectedEventsList() {
  const { data: events } = useDetectedEvents();
  const review = useReviewEvent();
  // Approved events leave the pending list; keep them briefly so we can offer Undo.
  const [applied, setApplied] = useState<DetectedEvent[]>([]);

  const pending = events ?? [];

  const act = (ev: DetectedEvent, action: "apply" | "dismiss") => {
    review.mutate(
      { id: ev.id, action },
      {
        onSuccess: () => {
          if (action === "apply") setApplied((a) => [ev, ...a]);
        },
      },
    );
  };

  const undo = (ev: DetectedEvent) => {
    review.mutate(
      { id: ev.id, action: "undo" },
      { onSuccess: () => setApplied((a) => a.filter((e) => e.id !== ev.id)) },
    );
  };

  const hasContent = pending.length > 0 || applied.length > 0;
  if (!hasContent) return null;

  return (
    <div className="space-y-2">
      {pending.map((ev) => (
        <div
          key={ev.id}
          className="flex items-center justify-between gap-3 rounded-md border p-2.5"
        >
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${EVENT_TONES[ev.event_type]}`}
              >
                {EVENT_LABELS[ev.event_type]}
              </span>
              {ev.target_stage && (
                <span className="text-xs text-muted-foreground">
                  → {ev.target_stage}
                </span>
              )}
            </div>
            <p className="truncate text-xs font-medium">{ev.subject}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {ev.from_addr}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2"
              onClick={() => act(ev, "apply")}
              disabled={review.isPending}
            >
              <Check className="h-3.5 w-3.5" /> Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground"
              onClick={() => act(ev, "dismiss")}
              disabled={review.isPending}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}

      {applied.map((ev) => (
        <div
          key={ev.id}
          className="flex items-center justify-between gap-3 rounded-md border border-dashed p-2.5 text-muted-foreground"
        >
          <p className="truncate text-xs">
            Moved to <strong>{ev.target_stage}</strong> — {ev.subject}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2"
            onClick={() => undo(ev)}
            disabled={review.isPending}
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </Button>
        </div>
      ))}
    </div>
  );
}

const REASON_LABELS: Record<Considered["reason"], string> = {
  filtered_contact: "Filtered out (not surfaced)",
  no_confident_match: "Signal seen, no confident job match",
};

/**
 * "What else I looked at" — a collapsible audit trail of the near-misses the
 * scan decided NOT to surface. This is where the user can verify the filtering
 * (e.g. spam that matched a saved company) and spot any real email we missed.
 * Pure spam (no job signal) is deliberately excluded — only decisions worth
 * reviewing appear here.
 */
function ConsideredList({ items }: { items: Considered[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground"
      >
        <span>What else I looked at ({items.length})</span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-2 border-t p-2">
          <p className="px-1 text-[11px] text-muted-foreground">
            These weren’t added to your board — either they matched a saved job
            but we don’t auto-surface them, or they looked like an update but
            couldn’t be confidently matched. Spam is hidden.
          </p>
          {items.map((c, i) => (
            <div key={i} className="rounded-md bg-muted/40 p-2.5 text-xs">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                  {REASON_LABELS[c.reason]}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {EVENT_LABELS[c.event_type]}
                </span>
              </div>
              <p className="truncate font-medium">{c.subject}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {c.from_addr}
                {c.date ? ` · ${new Date(c.date).toLocaleDateString()}` : ""}
              </p>
              {c.matched_company && (
                <p className="text-[11px] text-muted-foreground">
                  Matched: {c.matched_company}
                  {c.matched_title ? ` — ${c.matched_title}` : ""}
                </p>
              )}
              {c.mail_link && (
                <a
                  href={c.mail_link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 font-medium text-primary underline"
                >
                  Open email <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
