-- NOVELIGHT beta-author preopen access precheck.
\set ON_ERROR_STOP on
do $$
declare
  v_config_rls boolean;
  v_prereg_rls boolean;
  v_state text;
  v_constraint text;
begin
  if to_regclass('public.beta_author_preregistration_config') is null
     or to_regclass('public.beta_author_preregistrations') is null then
    raise exception 'beta author preregistration tables are required';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    raise exception 'supabase_auth_admin role is required';
  end if;

  select relrowsecurity into v_config_rls
    from pg_class
   where oid = 'public.beta_author_preregistration_config'::regclass;
  select relrowsecurity into v_prereg_rls
    from pg_class
   where oid = 'public.beta_author_preregistrations'::regclass;

  if v_config_rls is distinct from true or v_prereg_rls is distinct from true then
    raise exception 'beta author preregistration RLS must be enabled';
  end if;
  select state into v_state
    from public.beta_author_preregistration_config
   where id = 1;

  if v_state not in ('PRE_REGISTRATION', 'BETA_OPEN', 'CLOSED') then
    raise exception 'campaign state must be a pre-preopen canonical state';
  end if;

  select pg_get_constraintdef(oid)
    into v_constraint
    from pg_constraint
   where conrelid = 'public.beta_author_preregistration_config'::regclass
     and conname = 'beta_author_preregistration_config_state_check';

  if v_constraint is null
     or position('PRE_REGISTRATION' in v_constraint) = 0
     or position('BETA_OPEN' in v_constraint) = 0
     or position('CLOSED' in v_constraint) = 0
     or position('AUTHOR_PREOPEN' in v_constraint) > 0 then
    raise exception 'campaign state constraint drifted before preopen migration';
  end if;

  if to_regprocedure('public.hook_novelight_beta_signup_gate(jsonb)') is null then
    raise exception 'existing Auth signup gate is required';
  end if;
  if exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'beta_author_preregistrations'
       and policyname = 'beta_author_preregistrations_auth_preopen_lookup'
  ) then
    raise exception 'preopen Auth lookup policy already exists; inspect drift';
  end if;

  if has_column_privilege(
    'supabase_auth_admin',
    'public.beta_author_preregistrations',
    'email_normalized',
    'SELECT'
  ) or has_column_privilege(
    'supabase_auth_admin',
    'public.beta_author_preregistrations',
    'status',
    'SELECT'
  ) then
    raise exception 'preopen Auth lookup column grants already exist; inspect drift';
  end if;
end
$$;

select 'PASS: beta-author preopen access precheck' as result;
