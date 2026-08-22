-- NOVELIGHT: verification after 20260823074300.
-- Read-only. Fails when lifecycle columns or unique mappings are missing.

do $$
declare
  lifecycle_column_count integer;
begin
  select count(*) into lifecycle_column_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name in (
      'stripe_subscription_id',
      'stripe_subscription_created_at',
      'subscription_status',
      'subscription_cancel_at_period_end',
      'subscription_current_period_end'
    );

  if lifecycle_column_count <> 5 then
    raise exception 'Expected 5 Stripe lifecycle columns, found %', lifecycle_column_count;
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'profiles'
      and indexname = 'novelight_profiles_stripe_customer_id_unique'
  ) then
    raise exception 'Unique Stripe customer index is missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'profiles'
      and indexname = 'novelight_profiles_stripe_subscription_id_unique'
  ) then
    raise exception 'Unique Stripe subscription index is missing';
  end if;
end
$$;

select 'PASS: Stripe lifecycle state is installed' as result;
