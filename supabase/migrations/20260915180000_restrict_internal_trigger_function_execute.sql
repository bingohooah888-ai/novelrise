-- NOVELIGHT: internal trigger/event-trigger functions must not be callable by browser roles.
-- These functions execute only through their bound trigger/event-trigger paths.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260915180000-internal-trigger-execute'));

do $migration$
declare
  v_name text;
  v_oid oid;
  v_return_type text;
  v_security_definer boolean;
begin
  foreach v_name in array array[
    'assign_founding_author',
    'handle_new_user',
    'lock_first_publication_time',
    'novelight_enforce_novel_plan_limit',
    'rls_auto_enable'
  ] loop
    select p.oid,
           pg_catalog.format_type(p.prorettype, null),
           p.prosecdef
      into v_oid, v_return_type, v_security_definer
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = v_name
       and pg_get_function_identity_arguments(p.oid) = '';

    if v_oid is null then
      raise exception 'Required internal function public.%() is missing', v_name;
    end if;

    if v_security_definer is distinct from true then
      raise exception 'Required internal function public.%() is no longer SECURITY DEFINER', v_name;
    end if;

    if v_name = 'rls_auto_enable' and v_return_type <> 'event_trigger' then
      raise exception 'public.rls_auto_enable() must return event_trigger';
    elsif v_name <> 'rls_auto_enable' and v_return_type <> 'trigger' then
      raise exception 'public.%() must return trigger', v_name;
    end if;
  end loop;
end
$migration$;

revoke execute on function public.assign_founding_author() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.lock_first_publication_time() from public, anon, authenticated;
revoke execute on function public.novelight_enforce_novel_plan_limit() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Preserve the existing trusted server-operational capability explicitly.
grant execute on function public.assign_founding_author() to service_role;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.lock_first_publication_time() to service_role;
grant execute on function public.novelight_enforce_novel_plan_limit() to service_role;
grant execute on function public.rls_auto_enable() to service_role;

commit;
