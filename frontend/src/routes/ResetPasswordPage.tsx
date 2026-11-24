import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const MIN_PASSWORD = 8;

export const DISCONNECTED =
  "Your password is changed. Job Catcher was disconnected on all computers; press Connect in Job Catcher again.";
export const NOT_DISCONNECTED =
  "Your password is changed, but we couldn't disconnect Job Catcher right now. Open Job Catcher › Connected computers to disconnect them.";

/** Waits between tries when the server is waking up (Render's free tier). */
const RETRY_MS = [1500, 4000];

/** Disconnect every Job Catcher, trying again while the server wakes. */
async function revokeAll(waits: number[]): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      await api.post("/v1/extension/tokens/revoke-all", {});
      return true;
    } catch {
      if (attempt >= waits.length) return false;
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

/**
 * Choose a new password (spec 019). Reached from the emailed reset link,
 * which signs the person in for this one purpose.
 */
export default function ResetPasswordPage({ retryMs = RETRY_MS }: { retryMs?: number[] } = {}) {
  const navigate = useNavigate();
  const [ready, setReady] = useState<"checking" | "yes" | "no">("checking");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"" | "all" | "password-only">("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setReady(data.session ? "yes" : "no"));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady("yes");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== again) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setError("Couldn't save the new password. Open the link from the email again.");
      return;
    }
    // A reset may mean someone else knew the password: sign Job Catcher out
    // everywhere too.
    const revoked = await revokeAll(retryMs);
    setBusy(false);
    setDone(revoked ? "all" : "password-only");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center text-xl">Choose a new password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {ready === "checking" && (
            <p className="text-center text-sm text-muted-foreground">Checking your link…</p>
          )}
          {ready === "no" && (
            <p className="text-sm text-muted-foreground">
              This reset link has expired or was already used.{" "}
              <Link to="/forgot-password" className="underline">
                Send a new one
              </Link>
              .
            </p>
          )}
          {done && (
            <div className="space-y-3" role="status">
              <p className="text-sm">{done === "all" ? DISCONNECTED : NOT_DISCONNECTED}</p>
              {done === "password-only" && (
                <Button variant="outline" className="w-full" onClick={() => navigate("/job-catcher")}>
                  Open Connected computers
                </Button>
              )}
              <Button className="w-full" onClick={() => navigate("/", { replace: true })}>
                Continue
              </Button>
            </div>
          )}
          {ready === "yes" && !done && (
            <form onSubmit={save} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={MIN_PASSWORD}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password-again">New password again</Label>
                <Input
                  id="new-password-again"
                  type="password"
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                  required
                  minLength={MIN_PASSWORD}
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full gap-2" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Save new password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
