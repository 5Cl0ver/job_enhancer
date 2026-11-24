import * as React from "react";
import { Alert, Button, Card, Field, Input, Muted } from "@/ui";
import { appUrl, send } from "@/lib/chrome";
import { usePanel } from "@/lib/store";
import { Logo } from "@/App";

type Connect =
  | { state: "idle" }
  | { state: "waiting"; code: string; deadline: number }
  | { state: "expired" | "cancelled" };

/**
 * Signed out: "Connect to Job Enhancer" first (one press, approve in the app,
 * no password, so GitHub sign-ups work too), the old email + password second.
 */
export function SignIn() {
  const { refreshAuth } = usePanel();
  const [connect, setConnect] = React.useState<Connect>({ state: "idle" });
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [withPassword, setWithPassword] = React.useState(false);

  // The Connect under way, if any (the panel was closed and reopened). The
  // background does the waiting; this only reads its state and hears
  // "connectChanged" / "authChanged". Nothing runs while just signed out.
  const check = React.useCallback(async () => {
    const res = await send({ type: "connectStatus" });
    if (!res) return;
    if (res.state === "waiting") setConnect({ state: "waiting", code: res.code, deadline: res.deadline });
    else if (res.state === "expired" || res.state === "cancelled") {
      setConnect((c) => (c.state === "waiting" ? { state: res.state } : c));
    } else setConnect((c) => (c.state === "waiting" ? { state: "idle" } : c));
  }, []);

  React.useEffect(() => {
    check();
    const onMessage = (msg: { type?: string }) => {
      if (msg?.type === "authChanged") refreshAuth();
      if (msg?.type === "connectChanged") check();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [check, refreshAuth]);

  // While waiting, a cheap look every few seconds (reads local state only) in
  // case a message was missed while the worker slept.
  React.useEffect(() => {
    if (connect.state !== "waiting") return;
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, [connect.state, check]);

  async function start() {
    setStarting(true);
    setError("");
    const res = await send({ type: "connectStart" });
    setStarting(false);
    if (res?.ok) setConnect({ state: "waiting", code: res.code, deadline: res.deadline });
    else setError(res?.error || "Couldn't start connecting. Try again.");
  }

  async function cancel() {
    await send({ type: "connectCancel" });
    setConnect({ state: "idle" });
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center gap-4 px-4 py-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo className="size-10 [&_svg]:size-5" />
        <h1 className="text-lg font-semibold tracking-tight">Sign in to Job Catcher</h1>
        <Muted>Use your Job Enhancer account. Save jobs and fill applications from any site.</Muted>
      </div>

      <Card className="flex flex-col gap-3">
        {connect.state === "waiting" ? (
          <div className="flex flex-col gap-3" data-testid="connect-waiting">
            <p className="text-sm">Approve in the Job Enhancer tab. Check it shows this code:</p>
            <p className="text-center font-mono text-2xl font-bold tracking-widest" aria-label={`Code ${connect.code}`}>
              {connect.code}
            </p>
            <Muted className="text-center">Waiting for you to approve…</Muted>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={cancel}>
                Cancel
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => send({ type: "connectOpenTab" })}>
                Open the tab again
              </Button>
            </div>
          </div>
        ) : (
          <>
            {connect.state === "expired" && <Alert tone="warning">That took too long. Try again.</Alert>}
            {connect.state === "cancelled" && <Alert tone="info">Cancelled. Nothing was connected.</Alert>}
            <Button onClick={start} busy={starting} className="w-full">
              Connect to Job Enhancer
            </Button>
            <Muted className="text-center">Opens Job Enhancer, where you press Connect. No password needed.</Muted>
          </>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </Card>

      {withPassword ? (
        <PasswordSignIn />
      ) : (
        <button
          type="button"
          className="cursor-pointer text-center text-sm text-muted-foreground hover:underline"
          onClick={() => setWithPassword(true)}
        >
          or sign in with a password
        </button>
      )}

      <Muted className="text-center">
        No account?{" "}
        <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => chrome.tabs.create({ url: appUrl() })}>
          Create one in Job Enhancer
        </button>
      </Muted>
    </div>
  );
}

function PasswordSignIn() {
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
        <Button type="submit" busy={busy} variant="outline" className="w-full">
          Sign in
        </Button>
        <button
          type="button"
          className="cursor-pointer text-center text-xs text-muted-foreground hover:underline"
          onClick={() => chrome.tabs.create({ url: `${appUrl()}/forgot-password` })}
        >
          Forgot password?
        </button>
      </form>
    </Card>
  );
}
