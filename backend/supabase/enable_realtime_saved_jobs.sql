-- ============================================================================
-- Real-time sync for saved_jobs  (browser extension  ↔  web app)
-- ============================================================================
-- Goal: when a job is saved/removed (by the extension, the app, or another tab),
-- every open app tab for THAT user updates instantly — no refresh.
--
-- Mechanism: Supabase Realtime streams Postgres row changes to subscribed
-- clients. Realtime enforces Row-Level Security (RLS) per subscriber, so a user
-- only ever receives their OWN rows' changes.
--
-- Why this is safe for our backend: the FastAPI backend connects as the
-- `postgres` role, which has BYPASSRLS = true — so these policies (which target
-- the `authenticated` role used by the browser's Supabase session) do NOT affect
-- the backend's reads/writes. The `authenticated` role gets SELECT-only, so
-- clients can *listen* but never write directly; all writes still go through the
-- backend API.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- 1) Map a Supabase auth user (identified by the JWT's email claim) to OUR
--    app users.id. Needed because users.id is a fresh UUID, NOT the Supabase
--    auth uid — so we can't use the usual `user_id = auth.uid()`.
--    SECURITY DEFINER: runs as the function owner so it can read public.users
--    regardless of that table's own RLS.
create or replace function public.app_user_id_for_jwt()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.users
  where email = (auth.jwt() ->> 'email')
  limit 1
$$;

grant execute on function public.app_user_id_for_jwt() to authenticated;

-- 2) RLS: a logged-in user may SELECT (and therefore receive Realtime for) only
--    their own saved_jobs rows. No insert/update/delete policy → no direct
--    client writes; the backend (BYPASSRLS) handles those.
alter table public.saved_jobs enable row level security;
grant select on public.saved_jobs to authenticated;

drop policy if exists realtime_select_own_saved_jobs on public.saved_jobs;
create policy realtime_select_own_saved_jobs
  on public.saved_jobs
  for select
  to authenticated
  using (user_id = public.app_user_id_for_jwt());

-- 3) Emit the full old row on UPDATE/DELETE so RLS can be evaluated for them too
--    (default only emits the primary key).
alter table public.saved_jobs replica identity full;

-- 4) Publish saved_jobs changes onto the realtime stream (guarded so re-running
--    doesn't error with "already member of publication").
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'saved_jobs'
  ) then
    alter publication supabase_realtime add table public.saved_jobs;
  end if;
end $$;
