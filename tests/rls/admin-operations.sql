\set ON_ERROR_STOP on

select public.test_assert(
  not has_table_privilege('anon', 'public.announcements', 'SELECT'),
  'anon must not read announcements directly'
);
select public.test_assert(
  not has_table_privilege('authenticated', 'public.announcements', 'SELECT'),
  'authenticated must not read announcements directly'
);
select public.test_assert(
  not has_table_privilege('anon', 'public.admin_operation_audit', 'SELECT'),
  'anon must not read ADMIN audit rows'
);
select public.test_assert(
  not has_table_privilege('authenticated', 'public.admin_operation_audit', 'SELECT'),
  'authenticated must not read ADMIN audit rows'
);
select public.test_assert(
  not has_function_privilege(
    'anon',
    'public.novelight_admin_create_announcement(uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'anon must not execute announcement ADMIN mutation RPC'
);
select public.test_assert(
  not has_function_privilege(
    'authenticated',
    'public.novelight_admin_update_contact_inquiry_status(uuid,bigint,text)',
    'EXECUTE'
  ),
  'authenticated must not execute inquiry ADMIN mutation RPC'
);
select public.test_assert(
  has_function_privilege(
    'service_role',
    'public.novelight_admin_create_announcement(uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'service_role must execute announcement ADMIN mutation RPC'
);

set role service_role;
select *
  from public.novelight_admin_create_announcement(
    '11111111-1111-1111-1111-111111111111',
    'β版公開のお知らせ',
    '公開テスト本文です。',
    '運営',
    'draft'
  );
reset role;

select public.test_assert(
  (select count(*) from public.announcements) = 1,
  'ADMIN announcement create must store one row'
);
select public.test_assert(
  (select status from public.announcements limit 1) = 'draft',
  'new ADMIN announcement must retain requested draft status'
);
select public.test_assert(
  (
    select count(*)
      from public.admin_operation_audit
     where action = 'announcement.create'
       and resource_type = 'announcement'
  ) = 1,
  'announcement create must emit one audit row'
);

select id as announcement_id
  from public.announcements
 order by id
 limit 1
\gset

set role service_role;
select *
  from public.novelight_admin_update_announcement(
    '11111111-1111-1111-1111-111111111111',
    :announcement_id,
    'β版公開のお知らせ',
    '公開テスト本文です。',
    '運営',
    'published'
  );
reset role;

select public.test_assert(
  (
    select status = 'published' and published_at is not null
      from public.announcements
     limit 1
  ),
  'publishing an announcement must set published_at'
);
select public.test_assert(
  (
    select count(*)
      from public.admin_operation_audit
     where action = 'announcement.update'
  ) = 1,
  'announcement update must emit one audit row'
);

set role anon;
select public.submit_contact_inquiry(
  'ops-test@example.com',
  'その他',
  'ADMIN問い合わせstatus変更のテスト本文です。',
  'visitor-admin-ops-0001',
  ''
);
reset role;

select public.test_assert(
  (
    select status
      from public.contact_inquiries
     where email = 'ops-test@example.com'
     order by id desc
     limit 1
  ) = 'new',
  'inquiry fixture must start new'
);

select id as inquiry_id
  from public.contact_inquiries
 where email = 'ops-test@example.com'
 order by id desc
 limit 1
\gset

set role service_role;
select *
  from public.novelight_admin_update_contact_inquiry_status(
    '11111111-1111-1111-1111-111111111111',
    :inquiry_id,
    'reviewing'
  );
reset role;

select public.test_assert(
  (
    select status
      from public.contact_inquiries
     where email = 'ops-test@example.com'
     order by id desc
     limit 1
  ) = 'reviewing',
  'ADMIN inquiry status mutation must update the stored row'
);
select public.test_assert(
  (
    select count(*)
      from public.admin_operation_audit
     where action = 'contact_inquiry.status'
  ) = 1,
  'inquiry status mutation must emit one audit row'
);

-- Leave the new operations tables empty so the non-destructive rollback can run.
delete from public.admin_operation_audit;
delete from public.announcements;
delete from public.contact_inquiries where email = 'ops-test@example.com';
