begin;

-- Close the PRE_REGISTRATION bypass at the Supabase Auth layer.
-- The same singleton campaign state used by the public preregistration API remains
-- the source of truth. Only Supabase Auth may execute this hook or read the row.

grant usage on schema public to supabase_auth_admin;
grant select on table public.beta_author_preregistration_config to supabase_auth_admin;

create policy beta_author_preregistration_config_auth_signup_gate
  on public.beta_author_preregistration_config
  for select
  to supabase_auth_admin
  using (id = 1);

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

revoke execute on function public.hook_novelight_beta_signup_gate(jsonb)
  from public, anon, authenticated;
grant execute on function public.hook_novelight_beta_signup_gate(jsonb)
  to supabase_auth_admin;

comment on function public.hook_novelight_beta_signup_gate(jsonb) is
  'Supabase Before User Created hook. Rejects user creation while the beta campaign is PRE_REGISTRATION and fails closed if campaign state is unavailable.';

commit;
