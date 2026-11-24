import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Always the same words, whatever happened: never says whether an email
 *  has an account. */
export const RESET_SENT = "If that email has an account, a reset link is on its way. Check your inbox.";

/**
 * Forgot password (spec 019): emails a reset link. The link opens
 * /reset-password; if Supabase sends it to the start page instead, the
 * recovery watcher (lib/recovery.ts) brings the person to /reset-password.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch {
      // Same message either way.
    }
    setBusy(false);
    setSent(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center text-xl">Reset your password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {sent ? (
            <p role="status" className="text-sm text-muted-foreground">
              {RESET_SENT}
            </p>
          ) : (
            <form onSubmit={send} className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Enter the email you sign in with. We'll send a link to choose a new password.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <Button type="submit" className="w-full gap-2" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Send reset link
              </Button>
            </form>
          )}
          <p className="text-center text-sm">
            <Link to="/login" className="underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
