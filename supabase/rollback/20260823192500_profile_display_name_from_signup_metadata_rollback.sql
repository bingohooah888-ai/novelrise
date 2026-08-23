\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823192500'));

drop trigger if exists novelight_profiles_fill_signup_display_name on public.profiles;
drop function if exists public.novelight_fill_profile_display_name_from_signup();

-- Intentionally keep repaired display names. Rolling back the trigger must not erase user data.

commit;
