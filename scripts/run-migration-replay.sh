#!/usr/bin/env bash
set -euo pipefail

: "${PGPASSWORD:=postgres}"
export PGPASSWORD

host="${PGHOST:-127.0.0.1}"
user="${PGUSER:-postgres}"
replay_db="${NOVELIGHT_REPLAY_DB:-novelight_migration_replay}"

ADMIN=(psql -h "$host" -U "$user" -d postgres -v ON_ERROR_STOP=1)
REPLAY=(psql -h "$host" -U "$user" -d "$replay_db" -v ON_ERROR_STOP=1)

echo '::group::Prepare clean migration replay database'
"${ADMIN[@]}" -c "drop database if exists ${replay_db} with (force);"
"${ADMIN[@]}" -c "create database ${replay_db};"
echo '::endgroup::'

echo '::group::Install minimal Supabase auth compatibility fixture'
"${REPLAY[@]}" <<'SQL'
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end
$$;

create table auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now(),
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
SQL
echo '::endgroup::'

for migration in supabase/migrations/*.sql; do
  echo "::group::Replay $migration"
  "${REPLAY[@]}" -f "$migration"
  echo '::endgroup::'
done

echo '::group::Verify SCOUT usage controls, rollback and reapply'
"${REPLAY[@]}" -f supabase/checks/20260921025328_scout_record_usage_controls_postcheck.sql
"${REPLAY[@]}" -f supabase/rollback/20260921025328_scout_record_usage_controls_rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260921025328_scout_record_usage_controls_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260921025328_scout_record_usage_controls.sql
"${REPLAY[@]}" -f supabase/checks/20260921025328_scout_record_usage_controls_postcheck.sql
echo '::endgroup::'

echo '::group::Verify SCOUT RECORD beta core with dependent controls removed'
# The canonical Badge System adds triggers on SCOUT core tables. Remove the
# dependent catalog before exercising the historical core rollback, otherwise
# PostgreSQL correctly drops those dependent triggers with the core objects.
"${REPLAY[@]}" -f supabase/rollback/20260921063000_badge_system_catalog_rollback.sql
"${REPLAY[@]}" -f supabase/rollback/20260921025328_scout_record_usage_controls_rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260921025328_scout_record_usage_controls_precheck.sql
"${REPLAY[@]}" -f supabase/checks/20260920223049_scout_record_beta_core_postcheck.sql
"${REPLAY[@]}" -f supabase/rollback/20260920223049_scout_record_beta_core_rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260920223049_scout_record_beta_core_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260920223049_scout_record_beta_core.sql
"${REPLAY[@]}" -f supabase/checks/20260920223049_scout_record_beta_core_postcheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260921025328_scout_record_usage_controls.sql
"${REPLAY[@]}" -f supabase/checks/20260921025328_scout_record_usage_controls_postcheck.sql
"${REPLAY[@]}" -f supabase/checks/20260921063000_badge_system_catalog_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260921063000_badge_system_catalog.sql
echo '::endgroup::'

echo '::group::Verify canonical Badge System catalog, rollback and reapply'
"${REPLAY[@]}" -f supabase/checks/20260921063000_badge_system_catalog_postcheck.sql
"${REPLAY[@]}" -f tests/rls/badge-system-catalog.sql
"${REPLAY[@]}" -f supabase/rollback/20260921063000_badge_system_catalog_rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260921063000_badge_system_catalog_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260921063000_badge_system_catalog.sql
"${REPLAY[@]}" -f supabase/checks/20260921063000_badge_system_catalog_postcheck.sql
echo '::endgroup::'

echo '::group::Verify SCOUT badge foundation, rollback and reapply'
# The catalog depends on the foundation. Remove it first so the historical
# foundation postcheck/rollback is exercised against its own exact schema.
"${REPLAY[@]}" -f supabase/rollback/20260921063000_badge_system_catalog_rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260921022608_scout_badge_foundation_postcheck.sql
"${REPLAY[@]}" -f supabase/rollback/20260921022608_scout_badge_foundation_rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260921022608_scout_badge_foundation_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260921022608_scout_badge_foundation.sql
"${REPLAY[@]}" -f supabase/checks/20260921022608_scout_badge_foundation_postcheck.sql
"${REPLAY[@]}" -f supabase/checks/20260921063000_badge_system_catalog_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260921063000_badge_system_catalog.sql
"${REPLAY[@]}" -f supabase/checks/20260921063000_badge_system_catalog_postcheck.sql
echo '::endgroup::'

echo '::group::Verify work classification tags, RLS, rollback and reapply'
"${REPLAY[@]}" -f supabase/checks/20260920221000_novel_classification_tags_postcheck.sql
"${REPLAY[@]}" -f tests/rls/novel-classification-tags.sql
"${REPLAY[@]}" -f supabase/rollback/20260920221000_novel_classification_tags_rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260920221000_novel_classification_tags_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260920221000_novel_classification_tags.sql
"${REPLAY[@]}" -f supabase/checks/20260920221000_novel_classification_tags_postcheck.sql
echo '::endgroup::'

echo '::group::Verify Founding and beta participation rollback before behavior fixtures'
"${REPLAY[@]}" -f supabase/checks/20260920122000_founding_beta_qualifications_postcheck.sql
"${REPLAY[@]}" -f tests/rls/founding-beta-qualifications.sql
"${REPLAY[@]}" -f supabase/rollback/20260920122000_founding_beta_qualifications_rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260920122000_founding_beta_qualifications_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260920122000_founding_beta_qualifications.sql
"${REPLAY[@]}" -f supabase/checks/20260920122000_founding_beta_qualifications_postcheck.sql
echo '::endgroup::'

echo '::group::Verify replay reached the current schema contract'
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.favorites') is null
     or to_regclass('public.episode_hearts') is null
     or to_regclass('public.light_seeds') is null
     or to_regclass('public.novel_exposure_events') is null
     or to_regclass('public.founding_authors') is null
     or to_regclass('public.billing_checkout_attempts') is null then
    raise exception 'Fresh migration replay is missing one or more required tables';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'stripe_subscription_id'
  ) then
    raise exception 'Fresh migration replay did not reach Stripe subscription schema';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'novels'
       and column_name = 'first_published_at'
  ) then
    raise exception 'Fresh migration replay did not reach first-publication schema';
  end if;
end
$$;
SQL
echo '::endgroup::'

echo '::group::Verify atomic episode publication behavior'
"${REPLAY[@]}" -f supabase/checks/20260830163000_atomic_episode_publish_postcheck.sql
"${REPLAY[@]}" -f tests/rls/atomic-episode-publish.sql
echo '::endgroup::'

echo '::group::Verify atomic episode publication rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260830163000_atomic_episode_publish_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regprocedure(
    'public.novelight_publish_episode_atomic(bigint,bigint,text,text)'
  ) is not null then
    raise exception 'Atomic episode publish rollback left the RPC behind';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260830163000_atomic_episode_publish_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260830163000_atomic_episode_publish.sql
"${REPLAY[@]}" -f supabase/checks/20260830163000_atomic_episode_publish_postcheck.sql
echo '::endgroup::'

echo '::group::Verify Checkout attempt reservation behavior'
"${REPLAY[@]}" -f supabase/checks/20260830214000_checkout_attempt_reservations_postcheck.sql
echo '::endgroup::'

echo '::group::Verify Checkout attempt reservation rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260830214000_checkout_attempt_reservations_rollback.sql
"${REPLAY[@]}" -f tests/rls/checkout-attempt-reservations-rollback.sql
"${REPLAY[@]}" -f supabase/checks/20260830214000_checkout_attempt_reservations_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260830214000_checkout_attempt_reservations.sql
"${REPLAY[@]}" -f supabase/checks/20260830214000_checkout_attempt_reservations_postcheck.sql
echo '::endgroup::'

echo '::group::Verify LIGHT SEED public feed behavior'
"${REPLAY[@]}" -f supabase/checks/20260908120000_light_seed_public_feed_postcheck.sql
"${REPLAY[@]}" -f tests/rls/light-seed-public-feed.sql
echo '::endgroup::'

echo '::group::Verify LIGHT SEED public feed rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260908120000_light_seed_public_feed_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regprocedure('public.novelight_light_seed_feed(integer,integer)') is not null then
    raise exception 'LIGHT SEED public feed rollback left the RPC behind';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260908120000_light_seed_public_feed_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260908120000_light_seed_public_feed.sql
"${REPLAY[@]}" -f supabase/checks/20260908120000_light_seed_public_feed_postcheck.sql
echo '::endgroup::'

echo '::group::Verify LIGHT ANALYTICS runtime repair'
"${REPLAY[@]}" -f supabase/checks/20260908153000_fix_light_analytics_runtime_ordering_postcheck.sql
"${REPLAY[@]}" -f tests/rls/light-analytics-runtime.sql
echo '::endgroup::'

echo '::group::Verify LIGHT ANALYTICS runtime repair rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260908153000_fix_light_analytics_runtime_ordering_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
declare
  v_definition text;
begin
  select lower(pg_get_functiondef('public.novelight_author_exposure_funnel_v2(integer)'::regprocedure))
    into v_definition;

  if position('order by impressions desc nulls last, novel_id nulls last' in v_definition) = 0 then
    raise exception 'LIGHT ANALYTICS repair rollback did not restore the preceding implementation';
  end if;
end
$$;
SQL
"${REPLAY[@]}" -f supabase/checks/20260908153000_fix_light_analytics_runtime_ordering_precheck.sql
"${REPLAY[@]}" -f supabase/migrations/20260908153000_fix_light_analytics_runtime_ordering.sql
"${REPLAY[@]}" -f supabase/checks/20260908153000_fix_light_analytics_runtime_ordering_postcheck.sql
"${REPLAY[@]}" -f tests/rls/light-analytics-runtime.sql
echo '::endgroup::'

echo '::group::Verify LIGHT ANALYTICS visual trend behavior'
"${REPLAY[@]}" -f supabase/checks/20260908172000_light_analytics_visual_trends_postcheck.sql
"${REPLAY[@]}" -f tests/rls/light-analytics-visual-trends.sql
echo '::endgroup::'

echo '::group::Verify LIGHT ANALYTICS visual trend rollback and reapply'
"${REPLAY[@]}" -f supabase/rollback/20260908172000_light_analytics_visual_trends_rollback.sql
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regprocedure('public.novelight_author_analytics_timeseries(integer)') is not null then
    raise exception 'LIGHT ANALYTICS visual trend rollback left the RPC behind';