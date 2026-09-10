begin;

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
begin
  if length(trim(coalesce(p_website, ''))) > 0 then
    return 'registered';
  end if;

  if char_length(v_pen_name) not between 1 and 50 then
    raise exception 'ペンネームは1文字以上50文字以内で入力してください。' using errcode = '22023';
  end if;

  if char_length(v_email_normalized) not between 5 and 254
     or v_email_normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'メールアドレスを確認してください。' using errcode = '22023';
  end if;

  if v_x_account is not null and char_length(v_x_account) > 100 then
    raise exception 'Xアカウントは100文字以内で入力してください。' using errcode = '22023';
  end if;

  if v_work_url is not null and (
    char_length(v_work_url) > 2048
    or v_work_url !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception '作品URLを確認してください。' using errcode = '22023';
  end if;

  if v_genre is not null and char_length(v_genre) > 80 then
    raise exception 'ジャンルは80文字以内で入力してください。' using errcode = '22023';
  end if;

  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'コメントは500文字以内で入力してください。' using errcode = '22023';
  end if;

  if coalesce(p_consent, false) is not true then
    raise exception 'β版の公開・参加に関する連絡への同意が必要です。' using errcode = '22023';
  end if;

  if v_source not in ('x', 'youtube', 'dm', 'direct', 'other') then
    v_source := 'other';
  end if;

  if char_length(v_token) not between 8 and 200 then
    raise exception '送信情報を確認できませんでした。ページを再読み込みしてください。' using errcode = '22023';
  end if;

  v_visitor_key := md5(v_token);

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
) from public, service_role;
grant execute on function public.submit_beta_author_preregistration(
  text, text, text, text, text, text, boolean, text, text, text
) to anon, authenticated;

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
begin
  if v_event_type not in ('page_view', 'cta_click') then
    raise exception 'Unsupported preregistration event.' using errcode = '22023';
  end if;

  if v_source not in ('x', 'youtube', 'dm', 'direct', 'other') then
    v_source := 'other';
  end if;

  if char_length(v_token) not between 8 and 200 then
    return false;
  end if;

  insert into public.beta_author_preregistration_events (
    event_type,
    source,
    visitor_key
  ) values (
    v_event_type,
    v_source,
    md5(v_token)
  );

  return true;
end;
$$;

revoke all on function public.record_beta_author_preregistration_event(
  text, text, text
) from public, service_role;
grant execute on function public.record_beta_author_preregistration_event(
  text, text, text
) to anon, authenticated;

drop table if exists public.beta_author_preregistration_config;

commit;
