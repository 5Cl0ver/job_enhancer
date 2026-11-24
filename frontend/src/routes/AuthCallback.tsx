import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createClient } from "@/lib/supabase/client";
import { takeRememberedRedirect } from "@/lib/safeRedirect";

/**
 * Landing page for OAuth redirects (e.g. GitHub). supabase-js automatically
 * detects the session from the URL on load; we wait for it, then send the user
 * into the app.
 */
export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const supabase = createClient();
    // Where the person was going before GitHub (kept by Login), checked safe.
    const next = takeRememberedRedirect();

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate(next, { replace: true });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) navigate(next, { replace: true });
    });

    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Signing you in…
    </div>
  );
}
