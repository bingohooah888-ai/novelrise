-- NOVELIGHT: rollback for 20260823074300 Stripe lifecycle state.
-- Stripe-derived lifecycle data is backed up before the additive columns are removed.

begin;

select pg_advisory_xact_lock(hashtext('novelrise:20260823074300'));

create schema if not exists novelrise_migration_backup;
revoke all on schema novelrise_migration_backup from public;
revoke all on schema novelrise_migration_backup from anon, authenticated;

drop table if exists novelrise_migration_backup.stripe_lifecycle_20260823074300;

create table novelrise_migration_backup.stripe_lifecycle_20260823074300 as
select
  id,
  stripe_subscription_id,
  stripe_subscription_created_at,
  subscription_status,
  subscription_cancel_at_period_end,
  subscription_current_period_end
from public.profiles;

revoke all on novelrise_migration_backup.stripe_lifecycle_20260823074300 from public;
revoke all on novelrise_migration_backup.stripe_lifecycle_20260823074300 from anon, authenticated;

drop index if exists public.novelight_profiles_stripe_subscription_id_unique;
drop index if exists public.novelight_profiles_stripe_customer_id_unique;

alter table public.profiles
  drop column if exists stripe_subscription_id,
  drop column if exists stripe_subscription_created_at,
  drop column if exists subscription_status,
  drop column if exists subscription_cancel_at_period_end,
  drop column if exists subscription_current_period_end;

commit;
