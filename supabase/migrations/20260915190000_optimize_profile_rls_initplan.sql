-- NOVELIGHT: avoid per-row auth.uid() re-evaluation in profile write policies.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260915190000-profile-rls-initplan'));

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

commit;
