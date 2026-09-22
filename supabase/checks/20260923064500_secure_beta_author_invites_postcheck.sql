-- Postcheck for 20260923064500_secure_beta_author_invites
do $postcheck$
declare
  v_state text;
  v_hook_definition text;
  v_sync_definition text;
  v_assign_definition text;
begin
  if to_regclass('public.beta_author_invites') is null then
    raise exception 'beta_author_invites was not created';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='beta_author_invites'
      and c.relrowsecurity
  ) then
    raise exception 'beta_author_invites RLS is not enabled';
  end if;

  if has_table_privilege('anon','public.beta_author_invites','SELECT')
     or has_table_privilege('authenticated','public.beta_author_invites','SELECT')
     or has_table_privilege('anon','public.beta_author_invites','INSERT')
     or has_table_privilege('authenticated','public.beta_author_invites','INSERT') then
    raise exception 'Client roles must not access beta_author_invites';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='beta_author_invites'
      and column_name in ('token','raw_token','invite_token')
  ) then
    raise exception 'Raw invite token column must never exist';
  end if;

  if not has_column_privilege(
    'supabase_auth_admin',
    'public.beta_author_invites',
    'token_hash',
    'SELECT'
  ) then
    raise exception 'Auth hook token-hash SELECT grant is missing';
  end if;

  select pg_get_functiondef(
    'public.hook_novelight_beta_signup_gate(jsonb)'::regprocedure
  ) into v_hook_definition;

  if strpos(v_hook_definition, 'novelight_invite_token') = 0
     or strpos(v_hook_definition, 'pg_catalog.sha256') = 0
     or strpos(v_hook_definition, 'i.sent_at is not null') = 0
     or strpos(v_hook_definition, 'v_is_reserved and not v_has_valid_invite') = 0 then
    raise exception 'Secure signup hook contract is incomplete';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='hook_novelight_beta_signup_gate'
      and p.prosecdef
  ) then
    raise exception 'Before User Created hook must remain SECURITY INVOKER';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid='auth.users'::regclass
      and tgname='novelight_auth_user_00_consume_beta_author_invite'
      and not tgisinternal
  ) then
    raise exception 'Secure invite consumption trigger is missing';
  end if;

  if 'novelight_auth_user_00_consume_beta_author_invite'
     >= 'novelight_auth_user_sync_participation' then
    raise exception 'Invite consume trigger must sort before participation sync';
  end if;

  select pg_get_functiondef(
    'public.novelight_sync_user_participation_qualifications(uuid)'::regprocedure
  ) into v_sync_definition;

  if strpos(v_sync_definition, 'p.email_normalized = v_email') > 0 then
    raise exception 'Founding Author sync still trusts email-value matching';
  end if;
  if strpos(v_sync_definition, 'where p.auth_user_id = p_user_id') = 0 then
    raise exception 'Founding Author sync must use explicit Auth linkage';
  end if;

  select pg_get_functiondef(
    'public.assign_beta_author_founding_qualification()'::regprocedure
  ) into v_assign_definition;

  if strpos(v_assign_definition, 'auth.users') > 0
     or strpos(v_assign_definition, 'email_normalized') > 0 then
    raise exception 'New preregistration allocation still auto-links by email';
  end if;

  if strpos(
    pg_get_functiondef(
      'public.novelight_consume_beta_author_invite()'::regprocedure
    ),
    $$- 'novelight_invite_token'$$
  ) = 0 then
    raise exception 'Consumed bearer token is not scrubbed from Auth metadata';
  end if;

  select c.state into v_state
  from public.beta_author_preregistration_config c
  where c.id=1;
  if v_state is distinct from 'PRE_REGISTRATION' then
    raise exception 'Migration must not change campaign state';
  end if;
end
$postcheck$;
