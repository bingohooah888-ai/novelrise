-- NOVELIGHT: store Stripe subscription lifecycle state for safe entitlement sync.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823074300'));

alter table public.profiles
  add column stripe_subscription_id text,
  add column subscription_status text,
  add column subscription_cancel_at_period_end boolean not null default false,
  add column subscription_current_period_end timestamptz,
  add column stripe_last_event_created_at bigint,
  add column stripe_last_event_id text;

create unique index novelight_profiles_stripe_customer_id_unique
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null
    and stripe_customer_id <> '';

create unique index novelight_profiles_stripe_subscription_id_unique
  on public.profiles (stripe_subscription_id)
  where stripe_subscription_id is not null
    and stripe_subscription_id <> '';

commit;
