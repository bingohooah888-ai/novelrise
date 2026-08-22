\set ON_ERROR_STOP on

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  false
);

update public.profiles
set plan = 'premium',
    payment_status = 'failed',
    stripe_customer_id = 'cus_after_rollback'
where id = '33333333-3333-3333-3333-333333333333';

select public.test_assert(
  exists (
    select 1
    from public.profiles
    where id = '33333333-3333-3333-3333-333333333333'
      and plan = 'premium'
      and payment_status = 'failed'
      and stripe_customer_id = 'cus_after_rollback'
  ),
  'billing fields should be writable again after rollback'
);

insert into public.novels (id, user_id, status) values (
  '30000000-0000-0000-0000-000000000099',
  '33333333-3333-3333-3333-333333333333',
  'published'
);

select public.test_assert(
  (select count(*) = 2
   from public.novels
   where user_id = '33333333-3333-3333-3333-333333333333'),
  'novel plan limit should be removed after rollback'
);

reset role;

select 'PASS: billing/profile guard rollback restored prior behavior' as result;
