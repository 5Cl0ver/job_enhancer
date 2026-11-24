/**
 * A password-reset link can land on the app's start page instead of
 * /reset-password (when that address isn't on Supabase's allowed list, it
 * falls back to the Site URL). Wherever it lands, send the person to the page
 * that lets them choose a new password.
 *
 * Call before anything else creates the Supabase client: the reset link's
 * `type=recovery` is read off the address, and the PASSWORD_RECOVERY event is
 * caught as the client starts.
 */
import { createClient } from "@/lib/supabase/client";

export function isRecoveryLink(hash: string, search: string): boolean {
  return /(^|[#&?])type=recovery(&|$)/.test(`${hash}&${search}`);
}

export function watchPasswordRecovery(go: (path: string) => void): void {
  const toReset = () => {
    if (window.location.pathname !== "/reset-password") go("/reset-password");
  };
  if (isRecoveryLink(window.location.hash, window.location.search)) toReset();
  createClient().auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") toReset();
  });
}
