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
end
$$;

create table auth.users (
  id uuid primary key,
  created_at timestamptz not null default now(),
  raw_user_meta_data jsonb not null default '{}'::jsonb
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

echo '::group::Verify replay reached the current schema contract'
"${REPLAY[@]}" <<'SQL'
do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.novels') is null
     or to_regclass('public.episodes') is null
     or to_regclass('public.favorites') is null
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

echo 'Fresh NOVELIGHT migration replay passed.'
