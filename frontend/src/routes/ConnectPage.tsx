import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, Puzzle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { askProof } from "@/lib/jobCatcher";
import { useApproveConnect, useCancelConnect, useConnectStatus } from "@/hooks/useJobCatcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export const NOT_HERE =
  "Open this link in the same Chrome where Job Catcher is installed, by pressing Connect in Job Catcher.";

/**
 * Approve a Job Catcher (spec 019): "Connect Job Catcher on this computer to
 * you@…?" One press gives that Job Catcher its own pass.
 *
 * Only the Job Catcher that opened this page can be approved: the page asks
 * the Job Catcher in this Chrome for the proof of this exact code. A link
 * sent by someone else (from their Job Catcher) has no proof here, so it can
 * never connect their Job Catcher to this account.
 */
export default function ConnectPage() {
  const raw = new URLSearchParams(window.location.search).get("code") ?? "";
  const code = raw.toUpperCase();
  const valid = CODE.test(code);
  const [session, setSession] = useState<"checking" | "in" | "out">("checking");
  const [email, setEmail] = useState("");
  const [proof, setProof] = useState<"checking" | "none" | string>("checking");
  const [done, setDone] = useState<"" | "connected" | "cancelled">("");

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        setSession(data.session ? "in" : "out");
        setEmail(data.session?.user?.email ?? "");
      });
  }, []);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    askProof(code).then((p) => live && setProof(p ?? "none"));
    return () => {
      live = false;
    };
  }, [code, valid]);

  const status = useConnectStatus(code, valid && session === "in" && !done);
  const approve = useApproveConnect();
  const cancel = useCancelConnect();

  const signOut = async () => {
    await createClient().auth.signOut();
    window.location.href = `/login?redirect=${encodeURIComponent(`/connect?code=${code}`)}`;
  };

  let body: React.ReactNode;
  if (!valid) {
    body = <p className="text-sm text-muted-foreground">This link isn't complete. Press Connect in Job Catcher again.</p>;
  } else if (session === "checking" || (session === "in" && (status.isLoading || proof === "checking"))) {
    body = (
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking…
      </p>
    );
  } else if (session === "out") {
    body = (
      <div className="space-y-3 text-center">
        <p className="text-sm text-muted-foreground">Sign in to Job Enhancer first. You'll come right back here.</p>
        <Button asChild className="w-full">
          <Link to={`/login?redirect=${encodeURIComponent(`/connect?code=${code}`)}`}>Sign in</Link>
        </Button>
      </div>
    );
  } else if (done === "connected") {
    body = (
      <div className="space-y-2 text-center" role="status">
        <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
        <p className="font-medium">Connected.</p>
        <p className="text-sm text-muted-foreground">You can close this tab and go back to Job Catcher.</p>
      </div>
    );
  } else if (done === "cancelled") {
    body = <p className="text-center text-sm text-muted-foreground">Cancelled. Nothing was connected.</p>;
  } else if (status.isError || approve.isError) {
    body = <p className="text-sm text-muted-foreground">This link has expired. Press Connect in Job Catcher again.</p>;
  } else if (proof === "none") {
    body = <p className="text-sm text-muted-foreground">{NOT_HERE}</p>;
  } else {
    body = (
      <div className="space-y-4">
        <p className="text-sm">
          Connect Job Catcher on this computer to <span className="font-semibold">{email}</span>?
        </p>
        <div className="rounded-md border bg-muted/40 p-3 text-center">
          <p className="text-xs text-muted-foreground">Check it matches the code in Job Catcher</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-widest" aria-label={`Code ${code}`}>
            {code}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Job Catcher will be able to save jobs and fill applications for this account. You can
          disconnect it any time on the Job Catcher page.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={approve.isPending}
            onClick={() => cancel.mutate(code, { onSettled: () => setDone("cancelled") })}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 gap-2"
            disabled={approve.isPending}
            onClick={() => approve.mutate({ code, proof }, { onSuccess: () => setDone("connected") })}
          >
            {approve.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Connect
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Not you?{" "}
          <button type="button" className="underline" onClick={signOut}>
            Sign out and use another account
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <Puzzle className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-lg">Connect Job Catcher</CardTitle>
          <CardDescription>Sign Job Catcher in without a password.</CardDescription>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </div>
  );
}
