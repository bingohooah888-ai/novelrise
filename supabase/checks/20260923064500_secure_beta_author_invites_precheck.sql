-- Precheck for 20260923064500_secure_beta_author_invites
do $precheck$
declare
  v_state text;
  v_hook_security_definer boolean;
  v_sync_definition text;
begin
  if to_regclass('public.beta_author_invites') is not null then
    raise exception 'beta_author_invites already exists';
  end if;

  select c.state into v_state
  from public.beta_author_preregistration_config c
  where c.id = 1;

  if v_state is distinct from 'PRE_REGISTRATION' then
    raise exception 'Secure invite migration requires PRE_REGISTRATION; current state=%', v_state;
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public'
      and c.relname='beta_author_preregistrations'
      and c.relrowsecurity
  ) then
    raise exception 'beta_author_preregistrations RLS must be enabled';
  end if;

  select p.prosecdef
    into v_hook_security_definer
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname='hook_novelight_beta_signup_gate'
     and pg_get_function_identity_arguments(p.oid)='event jsonb';

  if v_hook_security_definer is null then
    raise exception 'Before User Created hook function is missing';
  end if;
  if v_hook_security_definer then
    raise exception 'Before User Created hook must remain SECURITY INVOKER';
  end if;

  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'pg_catalog.sha256(bytea) is required';
  end if;

  select pg_get_functiondef(
    'public.novelight_sync_user_participation_qualifications(uuid)'::regprocedure
  ) into v_sync_definition;

  if strpos(v_sync_definition, 'p.email_normalized = v_email') = 0
     and strpos(v_sync_definition, 'where p.auth_user_id = p_user_id') = 0 then
    raise exception 'Participation sync baseline is not recognized';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid='auth.users'::regclass
      and tgname='novelight_auth_user_sync_participation'
      and not tgisinternal
  ) then
    raise exception 'Participation sync trigger is missing';
  end if;
end
$precheck$;
