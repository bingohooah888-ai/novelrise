-- NOVELIGHT preregistration Auth signup gate postcheck.
\set ON_ERROR_STOP on

do $$
declare
  v_rls boolean;
  v_state text;
  v_response jsonb;
  v_function text;
  v_security_definer boolean;
  v_volatility "char";
begin
  if to_regclass('public.beta_author_preregistration_config') is null then
    raise exception 'public.beta_author_preregistration_config is missing';
  end if;

  select relrowsecurity
    into v_rls
    from pg_class
   where oid = 'public.beta_author_preregistration_config'::regclass;

  if v_rls is distinct from true then
    raise exception 'beta_author_preregistration_config RLS must remain enabled';
  end if;

  if not has_table_privilege('supabase_auth_admin', 'public.beta_author_preregistration_config', 'SELECT') then
    raise exception 'supabase_auth_admin must have SELECT on campaign config';
  end if;

  if has_table_privilege('anon', 'public.beta_author_preregistration_config', 'SELECT')
     or has_table_privilege('authenticated', 'public.beta_author_preregistration_config', 'SELECT') then
    raise exception 'campaign config must remain unreadable to client roles';
  end if;

  if not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'beta_author_preregistration_config'
       and policyname = 'beta_author_preregistration_config_auth_signup_gate'
       and cmd = 'SELECT'
       and 'supabase_auth_admin' = any(roles)
  ) then
    raise exception 'Auth signup gate RLS policy is missing or incorrect';
  end if;

  if to_regprocedure('public.hook_novelight_beta_signup_gate(jsonb)') is null then
    raise exception 'hook_novelight_beta_signup_gate(jsonb) is missing';
  end if;

  select p.prosecdef, p.provolatile, pg_get_functiondef(p.oid)
    into v_security_definer, v_volatility, v_function
    from pg_proc as p
   where p.oid = 'public.hook_novelight_beta_signup_gate(jsonb)'::regprocedure;

  if v_security_definer is distinct from false then
    raise exception 'Auth signup gate must remain SECURITY INVOKER';
  end if;

  if v_volatility <> 's' then
    raise exception 'Auth signup gate must remain STABLE';
  end if;

  if position('PRE_REGISTRATION' in v_function) = 0
     or position('BETA_OPEN' in v_function) = 0
     or position('CLOSED' in v_function) = 0
     or position('503' in v_function) = 0
     or position('403' in v_function) = 0 then
    raise exception 'Auth signup gate campaign-state contract is incomplete';
  end if;

  if has_function_privilege('public', 'public.hook_novelight_beta_signup_gate(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.hook_novelight_beta_signup_gate(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.hook_novelight_beta_signup_gate(jsonb)', 'EXECUTE')
     or not has_function_privilege('supabase_auth_admin', 'public.hook_novelight_beta_signup_gate(jsonb)', 'EXECUTE') then
    raise exception 'Auth signup gate function privileges are incorrect';
  end if;

  select state
    into v_state
    from public.beta_author_preregistration_config
   where id = 1;

  select public.hook_novelight_beta_signup_gate('{}'::jsonb)
    into v_response;

  if v_state = 'PRE_REGISTRATION' then
    if v_response #>> '{error,http_code}' <> '403' then
      raise exception 'PRE_REGISTRATION must reject new Auth users';
    end if;
  elsif v_state in ('BETA_OPEN', 'CLOSED') then
    if v_response <> '{}'::jsonb then
      raise exception 'BETA_OPEN/CLOSED must allow normal Auth signup';
    end if;
  else
    raise exception 'unexpected campaign state during postcheck';
  end if;
end
$$;

select 'PASS: preregistration Auth signup gate postcheck' as result;
