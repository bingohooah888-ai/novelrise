-- NOVELIGHT beta-author preopen access postcheck.
\set ON_ERROR_STOP on
do $$
declare
  v_config_rls boolean;
  v_prereg_rls boolean;
  v_constraint text;
  v_function text;
  v_security_definer boolean;
  v_volatility "char";
begin
  select relrowsecurity into v_config_rls
    from pg_class
   where oid = 'public.beta_author_preregistration_config'::regclass;
  select relrowsecurity into v_prereg_rls
    from pg_class
   where oid = 'public.beta_author_preregistrations'::regclass;

  if v_config_rls is distinct from true or v_prereg_rls is distinct from true then
    raise exception 'beta author preregistration RLS must remain enabled';
  end if;

  select pg_get_constraintdef(oid)
    into v_constraint
    from pg_constraint
   where conrelid = 'public.beta_author_preregistration_config'::regclass
     and conname = 'beta_author_preregistration_config_state_check';

  if v_constraint is null or position('AUTHOR_PREOPEN' in v_constraint) = 0 then
    raise exception 'AUTHOR_PREOPEN campaign state is missing';
  end if;
  if not has_column_privilege(
    'supabase_auth_admin',
    'public.beta_author_preregistrations',
    'email_normalized',
    'SELECT'
  ) or not has_column_privilege(
    'supabase_auth_admin',
    'public.beta_author_preregistrations',
    'status',
    'SELECT'
  ) then
    raise exception 'Auth admin preopen lookup column grants are missing';
  end if;

  if has_table_privilege(
    'supabase_auth_admin',
    'public.beta_author_preregistrations',
    'SELECT'
  ) then
    raise exception 'Auth admin must not receive broad preregistration SELECT';
  end if;

  if has_table_privilege('anon', 'public.beta_author_preregistrations', 'SELECT')
     or has_table_privilege('authenticated', 'public.beta_author_preregistrations', 'SELECT') then
    raise exception 'raw preregistrations must remain unreadable to client roles';
  end if;

  if not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'beta_author_preregistrations'
       and policyname = 'beta_author_preregistrations_auth_preopen_lookup'
       and cmd = 'SELECT'
       and 'supabase_auth_admin' = any(roles)
       and qual like '%status%cancelled%'
  ) then
    raise exception 'preopen Auth lookup RLS policy is missing or incorrect';
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

  if position('AUTHOR_PREOPEN' in v_function) = 0
     or position('{user,email}' in v_function) = 0
     or position('email_normalized' in v_function) = 0
     or position('status <> ''cancelled''' in v_function) = 0 then
    raise exception 'Auth signup gate preopen contract is incomplete';
  end if;

  if has_function_privilege('public', 'public.hook_novelight_beta_signup_gate(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.hook_novelight_beta_signup_gate(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.hook_novelight_beta_signup_gate(jsonb)', 'EXECUTE')
     or not has_function_privilege('supabase_auth_admin', 'public.hook_novelight_beta_signup_gate(jsonb)', 'EXECUTE') then
    raise exception 'Auth signup gate function privileges are incorrect';
  end if;
end
$$;

select 'PASS: beta-author preopen access postcheck' as result;
