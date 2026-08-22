-- NOVELIGHT: rollback for 20260823073000 billing/profile guards.
-- No user data is changed by this rollback.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823073000'));

drop trigger if exists novelight_enforce_novel_plan_limit on public.novels;
drop function if exists public.novelight_enforce_novel_plan_limit();

drop trigger if exists novelight_guard_profile_update on public.profiles;
drop function if exists public.novelight_guard_profile_update();

commit;
