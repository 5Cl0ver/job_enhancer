import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const MIN_PASSWORD = 8;

/**
 * Choose a new password (spec 019). Reached from the emailed reset link,
 * which signs the person in for this one purpose.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState<"checking" | "yes" | "no">("checking");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(false);
    if (error) {
      setError("Couldn't save the new password. Open the link from the email again.");
      return;
    }
    navigate("/", { replace: true });
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
          {ready === "yes" && (
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
