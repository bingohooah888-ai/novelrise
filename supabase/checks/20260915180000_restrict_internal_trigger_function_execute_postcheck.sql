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
    'novelight_enforce_novel_plan_limit'
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
    if has_function_privilege('anon', v_oid, 'EXECUTE') then
      raise exception 'anon must not execute public.%()', v_name;
    end if;
    if has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'authenticated must not execute public.%()', v_name;
    end if;
    if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'service_role must retain execute on public.%()', v_name;
    end if;

    select count(*) into v_binding_count
      from pg_trigger
     where tgfoid = v_oid and not tgisinternal;
    if v_binding_count < 1 then
      raise exception 'public.%() lost its trigger binding', v_name;
    end if;
  end loop;

  select p.oid
    into v_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'rls_auto_enable'
     and pg_get_function_identity_arguments(p.oid) = '';

  if v_oid is not null then
    if has_function_privilege('anon', v_oid, 'EXECUTE') then
      raise exception 'anon must not execute public.rls_auto_enable()';
    end if;
    if has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'authenticated must not execute public.rls_auto_enable()';
    end if;
    if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'service_role must retain execute on public.rls_auto_enable()';
    end if;
    select count(*) into v_binding_count from pg_event_trigger where evtfoid = v_oid;
    if v_binding_count < 1 then
      raise exception 'public.rls_auto_enable() lost its event-trigger binding';
    end if;
  end if;
end
$$;

select 'PASS: internal trigger functions are not executable by client roles' as result;
