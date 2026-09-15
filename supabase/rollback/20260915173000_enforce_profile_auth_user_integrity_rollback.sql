-- NOVELIGHT profile/Auth user integrity rollback.
--
-- This removes only the new referential constraint. Orphan profile rows removed
-- by the forward migration are intentionally not recreated because they have no
-- corresponding auth.users owner and restoring them would recreate invalid data.
\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260915173000-profile-auth-user-integrity'));

alter table public.profiles
  drop constraint if exists profiles_id_auth_user_fkey;

commit;

select 'PASS: profile/Auth user integrity rollback' as result;
