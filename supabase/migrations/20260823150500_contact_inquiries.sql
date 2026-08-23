begin;

create table public.contact_inquiries (
  id bigint generated always as identity primary key,
  email text not null,
  subject text not null,
  message text not null,
  visitor_key text not null,
  user_id uuid,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  constraint contact_inquiries_email_length check (char_length(email) between 5 and 254),
  constraint contact_inquiries_subject_length check (char_length(subject) between 2 and 100),
  constraint contact_inquiries_message_length check (char_length(message) between 10 and 4000),
  constraint contact_inquiries_visitor_key_length check (char_length(visitor_key) = 32),
  constraint contact_inquiries_status_check check (status in ('new', 'reviewing', 'resolved'))
);

create index contact_inquiries_created_at_idx
  on public.contact_inquiries (created_at desc);

create index contact_inquiries_visitor_rate_idx
  on public.contact_inquiries (visitor_key, created_at desc);

create index contact_inquiries_email_rate_idx
  on public.contact_inquiries ((lower(email)), created_at desc);

alter table public.contact_inquiries enable row level security;

revoke all on table public.contact_inquiries from anon, authenticated;
revoke all on sequence public.contact_inquiries_id_seq from anon, authenticated;

create or replace function public.submit_contact_inquiry(
  p_email text,
  p_subject text,
  p_message text,
  p_visitor_token text,
  p_website text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke all on function public.submit_contact_inquiry(text, text, text, text, text) from public;
grant execute on function public.submit_contact_inquiry(text, text, text, text, text)
  to anon, authenticated;

comment on table public.contact_inquiries is
  'Private NOVELIGHT support inquiries. Clients may submit only through submit_contact_inquiry; raw rows are not client-readable.';

comment on function public.submit_contact_inquiry(text, text, text, text, text) is
  'Validates and rate-limits public support inquiries without granting raw table access.';

commit;
