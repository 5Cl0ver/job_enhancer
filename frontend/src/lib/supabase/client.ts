import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

/**
 * Browser-side Supabase client (auth + session), as a singleton.
 *
 * A Vite SPA has no server, so we use the plain browser client from
 * `@supabase/supabase-js` — it stores the session in localStorage. We memoize
 * it so the whole app shares ONE client (multiple clients would fight over the
 * same session storage and log warnings).
 */
let _client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (!_client) {
    _client = createSupabaseClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
    );
  }
  return _client;
}
