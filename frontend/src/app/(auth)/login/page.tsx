"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Loader2, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Notice = { kind: "error" | "info"; text: string } | null;

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);
    if (error) {
      setNotice({ kind: "error", text: error.message });
      return;
    }
    router.push("/search");
    router.refresh();
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      setNotice({ kind: "error", text: error.message });
      return;
    }
    setNotice({
      kind: "info",
      text: "Check your email for a confirmation link to finish signing up.",
    });
  }

  async function resetPassword() {
    if (!email) {
      setNotice({ kind: "error", text: "Enter your email first." });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/callback?next=/settings`,
    });
    setBusy(false);
    setNotice(
      error
        ? { kind: "error", text: error.message }
        : { kind: "info", text: "Password reset email sent." },
    );
  }

  async function signInWithProvider(provider: "google" | "github") {
    setBusy(true);
    setNotice(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setBusy(false);
      setNotice({ kind: "error", text: error.message });
    }
    // On success the browser navigates away to the provider.
  }

  const emailPasswordFields = (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </div>
    </div>
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Briefcase className="h-5 w-5" aria-hidden />
          </div>
          <CardTitle className="text-xl">Job Enhancer</CardTitle>
          <CardDescription>
            Every job in one place. Track and apply faster.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {notice && (
            <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
              <AlertDescription>{notice.text}</AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="space-y-3 pt-2">
              <form onSubmit={signIn} className="space-y-3">
                {emailPasswordFields}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Mail className="h-4 w-4" aria-hidden />
                  )}
                  Sign in with email
                </Button>
              </form>
              <button
                type="button"
                onClick={resetPassword}
                className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Forgot password?
              </button>
            </TabsContent>

            <TabsContent value="signup" className="space-y-3 pt-2">
              <form onSubmit={signUp} className="space-y-3">
                {emailPasswordFields}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Mail className="h-4 w-4" aria-hidden />
                  )}
                  Create account
                </Button>
              </form>
              <p className="text-center text-xs text-muted-foreground">
                Minimum 8 characters. We&apos;ll email you a confirmation link.
              </p>
            </TabsContent>
          </Tabs>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <Button
              variant="outline"
              onClick={() => signInWithProvider("google")}
              disabled={busy}
            >
              {/* Google "G" mark */}
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
                <path
                  fill="currentColor"
                  d="M21.35 11.1h-9.17v2.98h5.3c-.23 1.24-.93 2.29-1.98 3v2.49h3.2c1.87-1.73 2.95-4.27 2.95-7.28 0-.47-.04-.93-.12-1.38l-.18.19Z"
                />
                <path
                  fill="currentColor"
                  d="M12.18 22c2.67 0 4.9-.89 6.53-2.42l-3.2-2.49c-.89.6-2.03.95-3.33.95-2.56 0-4.73-1.73-5.5-4.06H3.37v2.56A9.82 9.82 0 0 0 12.18 22Z"
                  opacity=".8"
                />
                <path
                  fill="currentColor"
                  d="M6.68 13.98a5.9 5.9 0 0 1 0-3.77V7.65H3.37a9.83 9.83 0 0 0 0 8.9l3.31-2.57Z"
                  opacity=".6"
                />
                <path
                  fill="currentColor"
                  d="M12.18 6.15c1.45 0 2.75.5 3.77 1.48l2.83-2.83A9.44 9.44 0 0 0 12.18 2a9.82 9.82 0 0 0-8.81 5.65l3.31 2.56c.77-2.33 2.94-4.06 5.5-4.06Z"
                  opacity=".9"
                />
              </svg>
              Continue with Google
            </Button>
            <Button
              variant="outline"
              onClick={() => signInWithProvider("github")}
              disabled={busy}
            >
              {/* GitHub mark */}
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
                <path
                  fill="currentColor"
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.72.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.9-.64.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.06 10.06 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"
                />
              </svg>
              Continue with GitHub
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
