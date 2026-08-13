import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldCheck } from "lucide-react";

/**
 * OAuth consent screen for the Claude connector.
 *
 * Supabase (our OAuth 2.1 Authorization Server) redirects here — its
 * `authorization_url_path` — during the connector's login. We confirm the user
 * is signed into the app (connector login = app login), show what Claude is
 * asking for, and approve/deny via Supabase's OAuth API. On a decision Supabase
 * hands back a `redirect_url` that returns the browser to claude.ai with the
 * authorization code.
 */
type Details = {
  client?: { name?: string; client_name?: string };
  redirect_uri?: string;
  scope?: string;
  scopes?: string[];
  redirect_url?: string; // present if already consented → skip straight through
};

export default function OAuthConsent() {
  const supabase = createClient();
  const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");

  const [state, setState] = useState<"loading" | "consent" | "needs-login" | "error">("loading");
  const [details, setDetails] = useState<Details | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization request. Start again from Claude.");
        setState("error");
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setState("needs-login");
        return;
      }
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (error) {
        setError(error.message);
        setState("error");
        return;
      }
      // Already consented before → Supabase returns a redirect_url to follow.
      if (data && "redirect_url" in data && data.redirect_url) {
        window.location.href = data.redirect_url as string;
        return;
      }
      setDetails(data as Details);
      setState("consent");
    })();
  }, [authorizationId, supabase]);

  const decide = async (approve: boolean) => {
    if (!authorizationId) return;
    setDeciding(true);
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);
    if (error) {
      setError(error.message);
      setState("error");
      setDeciding(false);
      return;
    }
    window.location.href = (data as { redirect_url: string }).redirect_url;
  };

  const clientName =
    details?.client?.name || details?.client?.client_name || "Claude";
  const scopes = details?.scopes ?? (details?.scope ? details.scope.split(" ") : []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-lg">Connect {clientName} to Job Enhancer</CardTitle>
          <CardDescription>
            {clientName} is asking to access your Job Enhancer account.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {state === "loading" && (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading request…
            </div>
          )}

          {state === "needs-login" && (
            <div className="space-y-3 text-center">
              <p className="text-sm text-muted-foreground">
                Sign in to Job Enhancer first, then approve the connection from
                Claude again.
              </p>
              <Button asChild className="w-full">
                <a
                  href={`/login?redirect=${encodeURIComponent(
                    window.location.pathname + window.location.search,
                  )}`}
                >
                  Sign in
                </a>
              </Button>
            </div>
          )}

          {state === "error" && (
            <p className="rounded-md bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error ?? "Something went wrong."}
            </p>
          )}

          {state === "consent" && (
            <>
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="mb-2 font-medium">This will let {clientName}:</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• Read your saved jobs, pipeline, and résumé/profile</li>
                  <li>• Save tailored drafts and update job statuses in the app</li>
                </ul>
                {scopes.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Scopes: {scopes.join(", ")}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={deciding}
                  onClick={() => decide(false)}
                >
                  Deny
                </Button>
                <Button className="flex-1" disabled={deciding} onClick={() => decide(true)}>
                  {deciding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Approve
                </Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                You can revoke this anytime in your Supabase account.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
