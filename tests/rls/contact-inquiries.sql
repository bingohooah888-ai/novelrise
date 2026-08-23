\set ON_ERROR_STOP on

select public.test_assert(
  not has_table_privilege('anon', 'public.contact_inquiries', 'SELECT'),
  'anon must not read contact inquiries directly'
);
select public.test_assert(
  not has_table_privilege('anon', 'public.contact_inquiries', 'INSERT'),
  'anon must not insert contact inquiries directly'
);
select public.test_assert(
  not has_table_privilege('authenticated', 'public.contact_inquiries', 'SELECT'),
  'authenticated must not read contact inquiries directly'
);
select public.test_assert(
  has_function_privilege(
    'anon',
    'public.submit_contact_inquiry(text,text,text,text,text)',
    'EXECUTE'
  ),
  'anon must be able to submit through the RPC'
);

set role anon;
select public.submit_contact_inquiry(
  'reader@example.com',
  '特定商取引法に基づく表示事項の開示請求',
  '販売業者情報の開示をお願いします。',
  'visitor-contact-test-0001',
  ''
);
reset role;

select public.test_assert(
  (select count(*) from public.contact_inquiries where email = 'reader@example.com') = 1,
  'valid anonymous inquiry must be stored once'
);

-- Honeypot submissions are accepted from the caller perspective but not stored.
set role anon;
select public.submit_contact_inquiry(
  'bot@example.com',
  'その他',
  'これは保存されないボット送信です。',
  'visitor-contact-bot-0001',
  'https://spam.invalid'
);
reset role;

select public.test_assert(
  (select count(*) from public.contact_inquiries where email = 'bot@example.com') = 0,
  'honeypot inquiry must not be stored'
);

-- Validation must reject malformed email addresses.
do $$
begin
  begin
    perform public.submit_contact_inquiry(
      'not-an-email',
      'その他',
      'メール形式エラーを確認する十分な長さの本文です。',
      'visitor-contact-invalid-0001',
      ''
    );
    raise exception 'expected invalid email to fail';
  exception
    when sqlstate '22023' then
      null;
  end;
end
$$;

-- Rate limiting: three submissions in ten minutes are allowed, the fourth fails.
set role anon;
select public.submit_contact_inquiry(
  'rate@example.com',
  'その他',
  'レート制限確認用の問い合わせ本文その一です。',
  'visitor-contact-rate-0001',
  ''
);
select public.submit_contact_inquiry(
  'rate@example.com',
  'その他',
  'レート制限確認用の問い合わせ本文その二です。',
  'visitor-contact-rate-0001',
  ''
);
select public.submit_contact_inquiry(
  'rate@example.com',
  'その他',
  'レート制限確認用の問い合わせ本文その三です。',
  'visitor-contact-rate-0001',
  ''
);
reset role;

do $$
begin
  begin
    perform public.submit_contact_inquiry(
      'rate@example.com',
      'その他',
      'レート制限確認用の問い合わせ本文その四です。',
      'visitor-contact-rate-0001',
      ''
    );
    raise exception 'expected fourth rapid inquiry to fail';
  exception
    when sqlstate 'P0001' then
      null;
  end;
end
$$;

-- Authenticated submissions retain the signed-in user id for operational context.
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  false
);
set role authenticated;
select public.submit_contact_inquiry(
  'author@example.com',
  '課金・解約',
  '契約内容について確認したいことがあります。',
  'visitor-contact-author-0001',
  ''
);
reset role;

select public.test_assert(
  (
    select user_id = '11111111-1111-1111-1111-111111111111'::uuid
      from public.contact_inquiries
     where email = 'author@example.com'
     order by id desc
     limit 1
  ),
  'authenticated inquiry must retain auth.uid()'
);

-- CI cleanup so the rollback safety guard can be exercised without discarding data.
delete from public.contact_inquiries;
