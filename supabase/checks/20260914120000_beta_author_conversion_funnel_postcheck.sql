-- NOVELIGHT beta-author conversion funnel postcheck.
\set ON_ERROR_STOP on

do $$
declare
  v_constraint text;
  v_function text;
  v_rls boolean;
begin
  if to_regclass('public.beta_author_preregistration_events') is null then
    raise exception 'public.beta_author_preregistration_events is missing';
  end if;

  select relrowsecurity
    into v_rls
    from pg_class
   where oid = 'public.beta_author_preregistration_events'::regclass;

  if v_rls is distinct from true then
    raise exception 'beta_author_preregistration_events RLS must remain enabled';
  end if;

  select pg_get_constraintdef(oid)
    into v_constraint
    from pg_constraint
   where conrelid = 'public.beta_author_preregistration_events'::regclass
     and conname = 'beta_author_preregistration_events_type_check';

  if v_constraint is null
     or position('page_view' in v_constraint) = 0
     or position('cta_click' in v_constraint) = 0
     or position('form_start' in v_constraint) = 0
     or position('register_click' in v_constraint) = 0 then
    raise exception 'conversion funnel event constraint is incomplete';
  end if;

  if to_regprocedure('public.record_beta_author_preregistration_event(text,text,text)') is null then
    raise exception 'record_beta_author_preregistration_event(text,text,text) is missing';
  end if;

  select pg_get_functiondef('public.record_beta_author_preregistration_event(text,text,text)'::regprocedure)
    into v_function;

  if position('form_start' in v_function) = 0
     or position('register_click' in v_function) = 0
     or position('pg_advisory_xact_lock' in v_function) = 0
     or position('interval ''60 seconds''' in v_function) = 0
     or position('interval ''5 seconds''' in v_function) = 0
     or position('interval ''1 hour''' in v_function) = 0 then
    raise exception 'conversion funnel event RPC safety contract is incomplete';
  end if;

  if has_function_privilege('public', 'public.record_beta_author_preregistration_event(text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_beta_author_preregistration_event(text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_beta_author_preregistration_event(text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.record_beta_author_preregistration_event(text,text,text)', 'EXECUTE') then
    raise exception 'conversion funnel event RPC privileges are incorrect';
  end if;
end
$$;

select 'PASS: beta-author conversion funnel postcheck' as result;
