-- NOVELIGHT: precheck before adding Stripe subscription lifecycle state.
-- Read-only. Abort on partial schema or ambiguous customer mappings.

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Required table public.profiles must exist';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name in (
        'id',
        'plan',
        'payment_status',
        'stripe_customer_id'
      )
  ) <> 4 then
    raise exception 'profiles is missing required billing columns';
  end if;

  if exists (
    select 1
    from public.profiles
    where stripe_customer_id is not null
      and stripe_customer_id <> ''
    group by stripe_customer_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate non-empty stripe_customer_id values exist';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name in (
        'stripe_subscription_id',
        'stripe_subscription_created_at',
        'subscription_status',
        'subscription_cancel_at_period_end',
        'subscription_current_period_end'
      )
  ) then
    raise exception 'Stripe lifecycle columns already exist or migration is partial';
  end if;
end
$$;

select 'PASS: Stripe lifecycle baseline is safe for migration' as result;
