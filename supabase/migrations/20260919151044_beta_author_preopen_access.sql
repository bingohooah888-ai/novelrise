begin;

alter table public.beta_author_preregistration_config
  drop constraint beta_author_preregistration_config_state_check;

alter table public.beta_author_preregistration_config
  add constraint beta_author_preregistration_config_state_check check (
    state in ('PRE_REGISTRATION', 'AUTHOR_PREOPEN', 'BETA_OPEN', 'CLOSED')
  );

grant select (email_normalized, status)
  on table public.beta_author_preregistrations
  to supabase_auth_admin;

create policy beta_author_preregistrations_auth_preopen_lookup
  on public.beta_author_preregistrations
  for select
  to supabase_auth_admin
  using (status <> 'cancelled');

create or replace function public.hook_novelight_beta_signup_gate(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_campaign_state text;
  v_email text;
  v_is_preregistered boolean := false;
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

  if v_campaign_state = 'AUTHOR_PREOPEN' then
    v_email := lower(btrim(coalesce(event #>> '{user,email}', '')));
    if v_email = '' then
      return jsonb_build_object(
        'error', jsonb_build_object(
          'http_code', 403,
          'message', '先行作者プレオープン中です。先行登録時と同じメールアドレスを使用してください。'
        )
      );
    end if;

    select exists (
      select 1
        from public.beta_author_preregistrations as preregistration
       where preregistration.email_normalized = v_email
         and preregistration.status <> 'cancelled'
    )
      into v_is_preregistered;

    if v_is_preregistered then
      return '{}'::jsonb;
    end if;

    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', '先行作者プレオープン中です。先行登録時と同じメールアドレスを使用してください。'
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
  'Supabase Before User Created hook. During AUTHOR_PREOPEN only non-cancelled preregistered author emails may create accounts; normal signup opens at BETA_OPEN/CLOSED.';

commit;
