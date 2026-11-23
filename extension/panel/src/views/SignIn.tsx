import * as React from "react";
import { Alert, Button, Card, Field, Input, Muted } from "@/ui";
import { appUrl, send } from "@/lib/chrome";
import { usePanel } from "@/lib/store";
import { Logo } from "@/App";

export function SignIn() {
  const { refreshAuth } = usePanel();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await send({ type: "login", email, password });
    setBusy(false);
    if (res?.ok) await refreshAuth();
    else setError(res?.error || "Couldn't sign in. Check your email and password.");
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center gap-4 px-4 py-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo className="size-10 [&_svg]:size-5" />
        <h1 className="text-lg font-semibold tracking-tight">Sign in to Job Catcher</h1>
        <Muted>Use your Job Enhancer account. Save jobs and fill applications from any site.</Muted>
      </div>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Email">
            {(id) => (
              <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </Field>
          <Field label="Password">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" busy={busy} className="w-full">
            Sign in
          </Button>
        </form>
      </Card>
      <Muted className="text-center">
        No account?{" "}
        <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => chrome.tabs.create({ url: appUrl() })}>
          Create one in Job Enhancer
        </button>
      </Muted>
    </div>
  );
}
