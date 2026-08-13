import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, Trash2, Loader2, Check } from "lucide-react";
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
import { ApplicationProfileCard } from "@/components/settings/ApplicationProfileCard";
import { SavedAnswersCard } from "@/components/settings/SavedAnswersCard";

export default function SettingsPage() {
  const { data: profile } = useProfile();
  const userEmail = profile?.email ?? "";

  return (
    <div className="container mx-auto max-w-2xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Account Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account and data.</p>
      </div>

      <ApplicationProfileCard />
      <ClaudeProjectCard />
      <SavedAnswersCard />
      <DataExportCard />
      <DeleteAccountCard email={userEmail} />
    </div>
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
