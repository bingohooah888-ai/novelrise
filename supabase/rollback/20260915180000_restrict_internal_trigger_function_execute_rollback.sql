-- NOVELIGHT internal trigger privilege rollback.
-- Restore the immediately preceding direct-execution ACLs only.
\set ON_ERROR_STOP on

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260915180000-internal-trigger-execute'));

grant execute on function public.assign_founding_author() to public, anon, authenticated, service_role;
grant execute on function public.handle_new_user() to public, anon, authenticated, service_role;
grant execute on function public.lock_first_publication_time() to public, anon, authenticated, service_role;
grant execute on function public.novelight_enforce_novel_plan_limit() to anon, authenticated, service_role;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'grant execute on function public.rls_auto_enable() to public, anon, authenticated, service_role';
  end if;
end
$$;

commit;

select 'PASS: internal trigger privilege rollback' as result;
