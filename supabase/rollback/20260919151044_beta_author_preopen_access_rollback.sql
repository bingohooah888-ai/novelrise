-- Roll back beta-author preopen Auth access without changing campaign state.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_state text;
begin
  select state into v_state
    from public.beta_author_preregistration_config
   where id = 1;

  if v_state = 'AUTHOR_PREOPEN' then
    raise exception 'Return campaign state from AUTHOR_PREOPEN before rollback';
  end if;
end
$$;

alter table public.beta_author_preregistration_config
  drop constraint beta_author_preregistration_config_state_check;

alter table public.beta_author_preregistration_config
  add constraint beta_author_preregistration_config_state_check check (
    state in ('PRE_REGISTRATION', 'BETA_OPEN', 'CLOSED')
  );

create or replace function public.hook_novelight_beta_signup_gate(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_campaign_state text;
begin
  select config.state
    into v_campaign_state
    from public.beta_author_preregistration_config as config
   where config.id = 1;

  if v_campaign_state is null then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 503,
        'message', '新規会員登録を一時的に停止しています。'
      )
    );
  end if;

  if v_campaign_state = 'PRE_REGISTRATION' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', '現在は先行作者登録期間です。一般会員登録はβ版公開までお待ちください。'
      )
    );
  end if;

  if v_campaign_state in ('BETA_OPEN', 'CLOSED') then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 503,
      'message', '新規会員登録を一時的に停止しています。'
    )
  );
end;
$$;

drop policy if exists beta_author_preregistrations_auth_preopen_lookup
  on public.beta_author_preregistrations;

revoke select (email_normalized, status)
  on table public.beta_author_preregistrations
  from supabase_auth_admin;

comment on function public.hook_novelight_beta_signup_gate(jsonb) is
  'Supabase Before User Created hook. Rejects user creation while the beta campaign is PRE_REGISTRATION and fails closed if campaign state is unavailable.';

commit;
