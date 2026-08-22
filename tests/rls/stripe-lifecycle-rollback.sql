\set ON_ERROR_STOP on

select public.test_assert(
  (
    select count(*) = 0
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name in (
        'stripe_subscription_id',
        'subscription_status',
        'subscription_cancel_at_period_end',
        'subscription_current_period_end',
        'stripe_last_event_created_at',
        'stripe_last_event_id'
      )
  ),
  'Stripe lifecycle columns must be removed by rollback'
);

select public.test_assert(
  to_regclass('novelrise_migration_backup.stripe_lifecycle_20260823074300') is not null,
  'Stripe lifecycle rollback backup must exist'
);

select public.test_assert(
  exists (
    select 1
    from novelrise_migration_backup.stripe_lifecycle_20260823074300
    where id = '33333333-3333-3333-3333-333333333333'
      and stripe_subscription_id = 'sub_admin_test'
      and stripe_last_event_id = 'evt_admin_test'
  ),
  'Stripe lifecycle rollback must preserve derivative state in backup'
);

select public.test_assert(
  to_regprocedure('public.novelight_guard_profile_update()') is not null,
  'Earlier billing guard must remain installed after lifecycle rollback'
);

select 'PASS: Stripe lifecycle rollback preserves backup and prior guards' as result;
