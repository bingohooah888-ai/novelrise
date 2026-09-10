begin;

create table public.beta_author_preregistration_config (
  id smallint primary key default 1,
  state text not null default 'PRE_REGISTRATION',
  release_label text not null default '2026年9月下旬',
  updated_at timestamptz not null default now(),
  constraint beta_author_preregistration_config_singleton check (id = 1),
  constraint beta_author_preregistration_config_state_check check (
    state in ('PRE_REGISTRATION', 'BETA_OPEN', 'CLOSED')
  ),
  constraint beta_author_preregistration_config_release_label_length check (
    char_length(release_label) between 1 and 100
  )
);

insert into public.beta_author_preregistration_config (id, state, release_label)
values (1, 'PRE_REGISTRATION', '2026年9月下旬');

alter table public.beta_author_preregistration_config enable row level security;

revoke all on table public.beta_author_preregistration_config
  from public, anon, authenticated;
grant select, insert, update, delete on table public.beta_author_preregistration_config
  to service_role;

create or replace function public.submit_beta_author_preregistration(
  p_pen_name text,
  p_email text,
  p_x_account text,
  p_work_url text,
  p_genre text,
  p_comment text,
  p_consent boolean,
  p_source text,
  p_visitor_token text,
  p_website text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_pen_name text := trim(coalesce(p_pen_name, ''));
  v_email text := trim(coalesce(p_email, ''));
  v_email_normalized text := lower(trim(coalesce(p_email, '')));
  v_x_account text := nullif(trim(coalesce(p_x_account, '')), '');
  v_work_url text := nullif(trim(coalesce(p_work_url, '')), '');
  v_genre text := nullif(trim(coalesce(p_genre, '')), '');
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_source text := lower(trim(coalesce(p_source, 'direct')));
  v_token text := trim(coalesce(p_visitor_token, ''));
  v_visitor_key text;
  v_recent_count integer;
  v_campaign_state text;
begin
  if length(trim(coalesce(p_website, ''))) > 0 then
    return 'registered';
  end if;

  select config.state
    into v_campaign_state
    from public.beta_author_preregistration_config as config
   where config.id = 1;

  if v_campaign_state is distinct from 'PRE_REGISTRATION' then
    raise exception '先行登録の受付は現在行っていません。'
      using errcode = 'P0001';
  end if;

  if char_length(v_pen_name) not between 1 and 50 then
    raise exception 'ペンネームは1文字以上50文字以内で入力してください。'
      using errcode = '22023';
  end if;

  if char_length(v_email_normalized) not between 5 and 254
     or v_email_normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'メールアドレスを確認してください。'
      using errcode = '22023';
  end if;

  if v_x_account is not null and char_length(v_x_account) > 100 then
    raise exception 'Xアカウントは100文字以内で入力してください。'
      using errcode = '22023';
  end if;

  if v_work_url is not null and (
    char_length(v_work_url) > 2048
    or v_work_url !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception '作品URLを確認してください。'
      using errcode = '22023';
  end if;

  if v_genre is not null and char_length(v_genre) > 80 then
    raise exception 'ジャンルは80文字以内で入力してください。'
      using errcode = '22023';
  end if;

  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'コメントは500文字以内で入力してください。'
      using errcode = '22023';
  end if;

  if coalesce(p_consent, false) is not true then
    raise exception 'β版の公開・参加に関する連絡への同意が必要です。'
      using errcode = '22023';
  end if;

  if v_source not in ('x', 'youtube', 'dm', 'direct', 'other') then
    v_source := 'other';
  end if;

  if char_length(v_token) <> 64 or v_token !~ '^[0-9a-f]{64}$' then
    raise exception '送信情報を確認できませんでした。ページを再読み込みしてください。'
      using errcode = '22023';
  end if;

  v_visitor_key := md5(v_token);

  perform pg_advisory_xact_lock(hashtextextended(v_visitor_key, 0));

  select count(*)
    into v_recent_count
    from public.beta_author_preregistrations
   where created_at >= now() - interval '10 minutes'
     and visitor_key = v_visitor_key;

  if v_recent_count >= 3 then
    raise exception '短時間に送信できる回数を超えました。時間をおいてお試しください。'
      using errcode = 'P0001';
  end if;

  insert into public.beta_author_preregistrations (
    pen_name,
    email,
    email_normalized,
    x_account,
    work_url,
    genre,
    comment,
    source,
    visitor_key
  ) values (
    v_pen_name,
    v_email,
    v_email_normalized,
    v_x_account,
    v_work_url,
    v_genre,
    v_comment,
    v_source,
    v_visitor_key
  );

  return 'registered';
exception
  when unique_violation then
    return 'duplicate';
end;
$$;

revoke all on function public.submit_beta_author_preregistration(
  text, text, text, text, text, text, boolean, text, text, text
) from public, anon, authenticated;
grant execute on function public.submit_beta_author_preregistration(
  text, text, text, text, text, text, boolean, text, text, text
) to service_role;

create or replace function public.record_beta_author_preregistration_event(
  p_event_type text,
  p_source text,
  p_visitor_token text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_event_type text := lower(trim(coalesce(p_event_type, '')));
  v_source text := lower(trim(coalesce(p_source, 'direct')));
  v_token text := trim(coalesce(p_visitor_token, ''));
  v_visitor_key text;
  v_campaign_state text;
  v_dedupe_interval interval;
  v_recent_exists boolean;
  v_hourly_count integer;
begin
  select config.state
    into v_campaign_state
    from public.beta_author_preregistration_config as config
   where config.id = 1;

  if v_campaign_state is distinct from 'PRE_REGISTRATION' then
    return false;
  end if;

  if v_event_type not in ('page_view', 'cta_click') then
    raise exception 'Unsupported preregistration event.' using errcode = '22023';
  end if;

  if v_source not in ('x', 'youtube', 'dm', 'direct', 'other') then
    v_source := 'other';
  end if;

  if char_length(v_token) <> 64 or v_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  v_visitor_key := md5(v_token);
  v_dedupe_interval := case
    when v_event_type = 'page_view' then interval '60 seconds'
    else interval '5 seconds'
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(v_visitor_key || ':' || v_event_type, 0)
  );

  select exists (
    select 1
      from public.beta_author_preregistration_events
     where visitor_key = v_visitor_key
       and event_type = v_event_type
       and created_at >= now() - v_dedupe_interval
  ) into v_recent_exists;

  if v_recent_exists then
    return true;
  end if;

  select count(*)
    into v_hourly_count
    from public.beta_author_preregistration_events
   where visitor_key = v_visitor_key
     and created_at >= now() - interval '1 hour';

  if v_hourly_count >= 120 then
    return false;
  end if;

  insert into public.beta_author_preregistration_events (
    event_type,
    source,
    visitor_key
  ) values (
    v_event_type,
    v_source,
    v_visitor_key
  );

  return true;
end;
$$;

revoke all on function public.record_beta_author_preregistration_event(
  text, text, text
) from public, anon, authenticated;
grant execute on function public.record_beta_author_preregistration_event(
  text, text, text
) to service_role;

comment on table public.beta_author_preregistration_config is
  'Private singleton campaign state. Public clients receive only state/release copy through the same-origin server API.';

comment on function public.submit_beta_author_preregistration(
  text, text, text, text, text, text, boolean, text, text, text
) is
  'Server-only preregistration intake. Enforces campaign state and per-request-fingerprint rate limiting before storing PII.';

comment on function public.record_beta_author_preregistration_event(
  text, text, text
) is
  'Server-only preregistration KPI event recorder with campaign-state enforcement, deduplication and bounded per-fingerprint volume.';

commit;
