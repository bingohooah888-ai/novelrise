-- Fail-closed rollback for 20260923064500_secure_beta_author_invites.
-- Once any real invite has been sent/consumed, automatic rollback is blocked:
-- taking redemption offline after distribution requires a separate incident plan.

begin;

select pg_advisory_xact_lock(hashtext('novelight:20260923064500:rollback'));

do $guard$
begin
  if to_regclass('public.beta_author_invites') is not null
     and exists (
       select 1
       from public.beta_author_invites
       where sent_at is not null
          or consumed_at is not null
     ) then
    raise exception 'Secure invite rollback blocked: real invite history exists';
  end if;
end
$guard$;

drop trigger if exists novelight_auth_user_00_consume_beta_author_invite
  on auth.users;
drop function if exists public.novelight_consume_beta_author_invite();

drop policy if exists beta_author_invites_auth_signup_lookup
  on public.beta_author_invites;

drop table if exists public.beta_author_invites;

-- Do not restore email-only Founding linkage. During rollback, AUTHOR_PREOPEN is
-- unavailable and preregistered email identities stay reserved at BETA_OPEN.
create or replace function public.hook_novelight_beta_signup_gate(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_campaign_state text;
  v_email text;
  v_is_reserved boolean := false;
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
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 503,
        'message', '先行利用の本人確認機能を一時停止しています。'
      )
    );
  end if;

  if v_campaign_state in ('BETA_OPEN', 'CLOSED') then
    v_email := lower(btrim(coalesce(event #>> '{user,email}', '')));

    if v_email <> '' then
      select exists (
        select 1
        from public.beta_author_preregistrations p
        where p.email_normalized = v_email
          and p.status <> 'cancelled'
          and p.auth_user_id is null
      ) into v_is_reserved;
    end if;

    if v_is_reserved then
      return jsonb_build_object(
        'error', jsonb_build_object(
          'http_code', 503,
          'message', 'このメールアドレスの先行登録資格を保護するため、現在は新規会員登録を一時停止しています。'
        )
      );
    end if;

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

-- Intentionally keep the hardened explicit-link-only Founding functions.
-- Reintroducing email-value linkage would recreate the identity takeover risk.

commit;
