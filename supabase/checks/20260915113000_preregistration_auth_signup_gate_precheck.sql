-- NOVELIGHT preregistration Auth signup gate precheck.
\set ON_ERROR_STOP on

do $$
declare
  v_rls boolean;
  v_state text;
begin
  if to_regclass('public.beta_author_preregistration_config') is null then
    raise exception 'public.beta_author_preregistration_config is required';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    raise exception 'supabase_auth_admin role is required';
  end if;

  select relrowsecurity
    into v_rls
    from pg_class
   where oid = 'public.beta_author_preregistration_config'::regclass;

  if v_rls is distinct from true then
    raise exception 'beta_author_preregistration_config RLS must be enabled';
  end if;

  select state
    into v_state
    from public.beta_author_preregistration_config
   where id = 1;

  if v_state not in ('PRE_REGISTRATION', 'BETA_OPEN', 'CLOSED') then
    raise exception 'campaign singleton state is missing or invalid';
  end if;

  if to_regprocedure('public.hook_novelight_beta_signup_gate(jsonb)') is not null then
    raise exception 'hook_novelight_beta_signup_gate(jsonb) already exists; inspect drift before applying';
  end if;

  if exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'beta_author_preregistration_config'
       and policyname = 'beta_author_preregistration_config_auth_signup_gate'
  ) then
    raise exception 'Auth signup gate RLS policy already exists; inspect drift before applying';
  end if;
end
$$;

select 'PASS: preregistration Auth signup gate precheck' as result;
