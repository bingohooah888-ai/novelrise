-- NOVELIGHT internal trigger privilege precheck.
\set ON_ERROR_STOP on

do $$
declare
  v_name text;
  v_oid oid;
  v_return_type text;
  v_security_definer boolean;
  v_binding_count integer;
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
      raise exception 'public.%() must remain SECURITY DEFINER', v_name;
    end if;

    if v_name = 'rls_auto_enable' then
      if v_return_type <> 'event_trigger' then
        raise exception 'public.rls_auto_enable() must return event_trigger';
      end if;
      select count(*) into v_binding_count from pg_event_trigger where evtfoid = v_oid;
    else
      if v_return_type <> 'trigger' then
        raise exception 'public.%() must return trigger', v_name;
      end if;
      select count(*) into v_binding_count from pg_trigger where tgfoid = v_oid and not tgisinternal;
    end if;

    if v_binding_count < 1 then
      raise exception 'public.%() has no active trigger binding', v_name;
    end if;

    if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'service_role must retain execute on public.%()', v_name;
    end if;
  end loop;
end
$$;

select 'PASS: internal trigger privilege precheck' as result;
