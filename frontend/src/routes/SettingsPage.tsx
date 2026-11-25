import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Download, Trash2, Loader2, Check } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useProfile, useUpdateProfile } from "@/hooks/useProfile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, getAccessToken, API_BASE } from "@/lib/api";
import { AppearanceCard } from "@/components/settings/AppearanceCard";
import { EmailConnectCard } from "@/components/settings/EmailConnectCard";
import { ResumesCard } from "@/components/settings/ResumesCard";
import { InfoBubble } from "@/components/common/InfoBubble";
import { Switch } from "@/components/ui/switch";
import { useOnboarding, useUpdateOnboarding } from "@/hooks/useOnboarding";
import type { HelpKey } from "@/lib/help";

export default function SettingsPage() {
  const { data: profile } = useProfile();
  const userEmail = profile?.email ?? "";

  return (
    <div className="container mx-auto flex max-w-2xl flex-col gap-3 md:gap-6 md:px-4 md:py-6">
      <div className="space-y-1 max-md:hidden">
        <h1 className="text-2xl font-bold tracking-tight">Account Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account and data.</p>
      </div>

      <Section id="appearance" title="Appearance">
        <AppearanceCard />
        <GettingStartedCard />
      </Section>
      <Section id="resumes" title="Résumés">
        <ResumesCard />
      </Section>
      <Section id="profile" title="Application profile & saved answers">
        <AutofillMemoryLink />
      </Section>
      <Section id="claude" title="Claude" help="settingsClaude">
        <ConnectClaudeCard />
        <ClaudeProjectCard />
      </Section>
      <Section id="email" title="Email" help="settingsEmail">
        <EmailConnectCard />
      </Section>
      <Section id="export" title="Export your data" help="settingsExport">
        <DataExportCard />
      </Section>
      <Section id="delete" title="Delete account">
        <DeleteAccountCard email={userEmail} />
      </Section>
    </div>
  );
}

/**
 * On a phone, Settings is a short list: each part is one row that opens when
 * tapped, instead of seven cards end to end. On a computer the row isn't there
 * and the card shows as it is. The card stays mounted either way, so nothing
 * typed into it is lost by closing its row or turning the phone. `id` lets a
 * link open one part directly (`/settings#email`).
 */
function Section({
  id,
  title,
  help,
  children,
}: {
  id: string;
  title: string;
  /** An ⓘ beside the title (spec 019). */
  help?: HelpKey;
  children: React.ReactNode;
}) {
  const { hash } = useLocation();
  const linked = hash === `#${id}`;
  const [open, setOpen] = useState(linked);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!linked) return;
    setOpen(true);
    ref.current?.scrollIntoView({ block: "start" });
  }, [linked]);

  return (
    <section
      ref={ref}
      id={id}
      className="scroll-mt-16 max-md:overflow-hidden max-md:rounded-xl max-md:border max-md:bg-card md:contents"
    >
      <div className="flex items-center pr-2 md:hidden">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-14 flex-1 items-center justify-between gap-3 px-4 text-left text-base font-medium active:bg-accent"
        >
          {title}
          <ChevronDown
            className={cn("h-5 w-5 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
        {help && <InfoBubble topic={help} />}
      </div>
      {help && (
        <h2 className="-mb-3 flex items-center gap-1 text-sm font-semibold text-muted-foreground max-md:hidden">
          {title} <InfoBubble topic={help} />
        </h2>
      )}
      {/* On a phone the card inside loses its own frame and title: the row is both. */}
      <div
        className={cn(
          "md:contents max-md:border-t max-md:*:data-[slot=card]:rounded-none max-md:*:data-[slot=card]:ring-0 max-md:**:data-[slot=card-title]:hidden",
          !open && "max-md:hidden",
        )}
      >
        {children}
      </div>
    </section>
  );
}

function ClaudeProjectCard() {
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState(false);

  // Seed the field from the account once it loads.
  useEffect(() => {
    setUrl(profile?.claude_project_url ?? "");
  }, [profile?.claude_project_url]);

  const dirty = (profile?.claude_project_url ?? "") !== url.trim();

  const handleSave = () => {
    update.mutate(
      { claude_project_url: url.trim() },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Claude Project</CardTitle>
        <CardDescription>
          Paste your Claude Project link. Drafts and company research open here — in
          the app <strong>and</strong> the browser extension (this is shared, so
          editing it in either place updates both). Leave blank to use a normal
          Claude chat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="claude-url">Project link</Label>
        <div className="flex gap-2">
          <Input
            id="claude-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://claude.ai/project/…"
            spellCheck={false}
          />
          <Button onClick={handleSave} disabled={!dirty || update.isPending} className="gap-1.5">
            {update.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <Check className="h-4 w-4" />
            ) : null}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DataExportCard() {
  const [downloading, setDownloading] = useState(false);

  const handleExport = async () => {
    setDownloading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_BASE}/v1/users/me/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "job_enhancer_export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Silent — user can retry
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Export Your Data</CardTitle>
        <CardDescription>
          Download all your saved jobs, collections, pipeline stages, and generated documents as a
          JSON file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={handleExport} disabled={downloading} className="gap-2">
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export Data
        </Button>
      </CardContent>
    </Card>
  );
}

function DeleteAccountCard({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  const deleteAccount = useMutation({
    mutationFn: () => api.delete("/v1/users/me"),
    onSuccess: async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.href = "/login";
    },
  });

  const canDelete = confirmation === email && !deleteAccount.isPending;

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Delete Account</CardTitle>
        <CardDescription>
          Permanently delete your account and all associated data. This action cannot be undone.
          Shared job listings will remain for other users.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" className="gap-2">
              <Trash2 className="h-4 w-4" />
              Delete Account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Are you absolutely sure?</DialogTitle>
              <DialogDescription>
                This will permanently delete your account. Type your email address to confirm.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="confirm-email">Type <strong>{email}</strong> to confirm</Label>
              <Input
                id="confirm-email"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={email}
                autoComplete="off"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!canDelete}
                onClick={() => deleteAccount.mutate()}
              >
                {deleteAccount.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Delete My Account"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/** The profile and everything autofill learned live on their own page now (spec 018). */
function AutofillMemoryLink() {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <p className="text-sm text-muted-foreground">
          Your application profile, the answers Job Catcher saved and the boxes you taught it
          are in <b className="text-foreground">Autofill memory</b>.
        </p>
        <Link to="/autofill" className="text-sm font-medium text-primary underline underline-offset-2">
          Open Autofill memory
        </Link>
      </CardContent>
    </Card>
  );
}

/** Getting started and the Welcome can always come back (spec 019). */
function GettingStartedCard() {
  const { data } = useOnboarding();
  const update = useUpdateOnboarding();
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Getting started</CardTitle>
        <CardDescription>The setup list on Find Jobs and My Jobs, and the welcome tour.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          Show Getting started
          <Switch
            checked={data ? !data.checklist_hidden : true}
            disabled={!data || update.isPending}
            onCheckedChange={(on) => update.mutate({ checklist_hidden: !on })}
          />
        </label>
        <Button
          variant="outline"
          className="self-start"
          disabled={update.isPending}
          onClick={() => update.mutate({ welcome_done: false }, { onSuccess: () => navigate("/welcome") })}
        >
          Show the welcome again
        </Button>
      </CardContent>
    </Card>
  );
}

/** Where Claude connects (spec 019): the address and the four steps, in plain words. */
function ConnectClaudeCard() {
  const address = `${API_BASE.replace(/\/+$/, "")}/mcp`;
  const [copied, setCopied] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Connect Claude (optional)</CardTitle>
        <CardDescription>
          Lets your own Claude save jobs here, read your profile and run Claude Scout. Not needed
          for anything else in the app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            On claude.ai, open <b>Settings › Connectors</b> and press <b>Add custom connector</b>.
          </li>
          <li>Name it Job Enhancer and paste this address. Leave everything else empty.</li>
          <li>Press Connect, sign in here if asked, then press Approve.</li>
          <li>In a chat, try: “List my saved jobs”.</li>
        </ol>
        <div className="flex gap-2">
          <Input readOnly value={address} aria-label="Connector address" className="font-mono text-xs" />
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // select it by hand
              }
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
