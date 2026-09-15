-- NOVELIGHT internal trigger privilege postcheck.
\set ON_ERROR_STOP on

do $$
declare
  v_name text;
  v_oid oid;
  v_binding_count integer;
begin
  foreach v_name in array array[
    'assign_founding_author',
    'handle_new_user',
    'lock_first_publication_time',
    'novelight_enforce_novel_plan_limit',
    'rls_auto_enable'
  ] loop
    select p.oid
      into v_oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = v_name
       and pg_get_function_identity_arguments(p.oid) = '';

    if v_oid is null then
      raise exception 'Required internal function public.%() is missing', v_name;
    end if;

    -- Effective client-role checks also catch any lingering grant through PUBLIC.
    if has_function_privilege('anon', v_oid, 'EXECUTE') then
      raise exception 'anon must not execute public.%()', v_name;
    end if;
    if has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'authenticated must not execute public.%()', v_name;
    end if;
    if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'service_role must retain execute on public.%()', v_name;
    end if;

    if v_name = 'rls_auto_enable' then
      select count(*) into v_binding_count from pg_event_trigger where evtfoid = v_oid;
    else
      select count(*) into v_binding_count from pg_trigger where tgfoid = v_oid and not tgisinternal;
    end if;

    if v_binding_count < 1 then
      raise exception 'public.%() lost its trigger binding', v_name;
    end if;
  end loop;
end
$$;

select 'PASS: internal trigger functions are not executable by client roles' as result;
