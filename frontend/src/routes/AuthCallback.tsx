import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createClient } from "@/lib/supabase/client";

/**
 * Landing page for OAuth redirects (e.g. GitHub). supabase-js automatically
 * detects the session from the URL on load; we wait for it, then send the user
 * into the app.
 */
export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate("/search", { replace: true });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) navigate("/search", { replace: true });
    });

    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Signing you in…
    </div>
  );
}
