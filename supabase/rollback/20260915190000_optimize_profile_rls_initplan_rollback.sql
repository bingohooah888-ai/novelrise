-- NOVELIGHT profile RLS initplan rollback.
\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260915190000-profile-rls-initplan'));

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

commit;

select 'PASS: profile RLS initplan rollback' as result;
