-- Ensure the public submission count/insert rate-limit check is atomic
-- for shared identity keys during bursts of concurrent requests.
-- Preserve the existing caps, validation, guest access and PRIVILEGES.
-- Locks are transaction-scoped; PostgreSQL releases them automatically.
-- Rotating anonymous visitor tokens remains a separate abuse concern.
begin;

CREATE OR REPLACE FUNCTION public.submit_contact_inquiry(p_email text, p_subject text, p_message text, p_visitor_token text, p_website text DEFAULT ''::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_subject text := trim(coalesce(p_subject, ''));
  v_message text := trim(coalesce(p_message, ''));
  v_token text := trim(coalesce(p_visitor_token, ''));
  v_visitor_key text;
  v_recent_count integer;
begin
  -- Honeypot: bots commonly fill hidden website fields. Silently accept
  -- without storing anything so the form does not become a spam oracle.
  if length(trim(coalesce(p_website, ''))) > 0 then
    return true;
  end if;

  if char_length(v_email) not between 5 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'メールアドレスを確認してください。' using errcode = '22023';
  end if;

  if char_length(v_subject) not between 2 and 100 then
    raise exception 'お問い合わせ種別を確認してください。' using errcode = '22023';
  end if;

  if char_length(v_message) not between 10 and 4000 then
    raise exception 'お問い合わせ内容は10文字以上4000文字以内で入力してください。' using errcode = '22023';
  end if;

  if char_length(v_token) not between 8 and 200 then
    raise exception '送信情報を確認できませんでした。ページを再読み込みしてください。' using errcode = '22023';
  end if;

  v_visitor_key := md5(v_token);

  -- Serialize submissions before the count/insert pair. Lock keys are
  -- namespaced and acquired in a fixed order to avoid deadlocks.
  -- Include email to prevent racing with different visitor tokens.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:contact:email:' || v_email, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:contact:visitor:' || v_visitor_key, 0)
  );

  select count(*)
    into v_recent_count
    from public.contact_inquiries
   where created_at >= now() - interval '10 minutes'
     and (
       visitor_key = v_visitor_key
       or lower(email) = v_email
     );

  if v_recent_count >= 3 then
    raise exception '短時間に送信できる回数を超えました。時間をおいてお試しください。'
      using errcode = 'P0001';
  end if;

  insert into public.contact_inquiries (
    email,
    subject,
    message,
    visitor_key,
    user_id
  ) values (
    v_email,
    v_subject,
    v_message,
    v_visitor_key,
    auth.uid()
  );

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_content_report(p_novel_id text, p_episode_id text, p_category text, p_details text, p_visitor_token text, p_website text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_token text := btrim(coalesce(p_visitor_token, ''));
  v_hash text;
  v_author_id uuid;
  v_details text := btrim(coalesce(p_details, ''));
  v_recent integer;
  v_id uuid;
begin
  -- Honeypot: silently accept without storing.
  if char_length(btrim(coalesce(p_website, ''))) > 0 then
    return null;
  end if;

  if p_category not in (
    'copyright', 'prohibited_content', 'harassment', 'spam',
    'ai_misclassification', 'other'
  ) then
    raise exception using errcode = '22023', message = '通報理由を確認してください';
  end if;

  if char_length(v_details) not between 5 and 4000 then
    raise exception using errcode = '22023', message = '通報内容は5文字以上4000文字以内で入力してください';
  end if;

  if char_length(v_token) not between 8 and 200 then
    raise exception using errcode = '22023', message = '送信情報を確認できませんでした';
  end if;

  select n.user_id
    into v_author_id
    from public.novels n
   where n.id::text = p_novel_id
     and n.status = 'published';

  if not found then
    raise exception using errcode = '23514', message = '通報対象の公開作品が見つかりません';
  end if;

  if p_episode_id is not null and not exists (
    select 1
      from public.episodes e
     where e.id::text = p_episode_id
       and e.novel_id::text = p_novel_id
       and e.status = 'published'
  ) then
    raise exception using errcode = '23514', message = '通報対象のエピソードが見つかりません';
  end if;

  v_hash := md5(v_token);

  -- Serialize authenticated submissions across rotating visitor tokens;
  -- then serialize by visitor token for anonymous submissions.
  -- Consistent user-then-visitor lock order avoids deadlocks.
  if v_uid is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('novelight:report:user:' || v_uid::text, 0)
    );
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novelight:report:visitor:' || v_hash, 0)
  );

  select count(*)::integer
    into v_recent
    from public.content_reports r
   where r.created_at >= now() - interval '1 hour'
     and (
       r.visitor_key_hash = v_hash
       or (v_uid is not null and r.reporter_id = v_uid)
     );

  if v_recent >= 5 then
    raise exception using errcode = 'P0001', message = '短時間に送信できる通報数を超えました';
  end if;

  insert into public.content_reports (
    reporter_id,
    visitor_key_hash,
    novel_id_snapshot,
    episode_id_snapshot,
    author_id_snapshot,
    category,
    details
  ) values (
    v_uid,
    v_hash,
    p_novel_id,
    p_episode_id,
    v_author_id,
    p_category,
    v_details
  )
  returning id into v_id;

  return v_id;
end
$function$;

commit;
