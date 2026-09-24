#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${PGHOST:-127.0.0.1}"
DB_PORT="${PGPORT:-5432}"
DB_USER="${PGUSER:-postgres}"
DB_NAME="${PGDATABASE:-${NOVELIGHT_REPLAY_DB:-novelight_migration_replay}}"

psql_base=(
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
  -v ON_ERROR_STOP=1
)

session_a_log=$(mktemp)
session_b_log=$(mktemp)
cleanup() {
  rm -f "$session_a_log" "$session_b_log"
}
trap cleanup EXIT

"${psql_base[@]}" <<'SQL'
insert into auth.users (id, email, raw_user_meta_data)
values (
  '94100000-0000-0000-0000-000000000001',
  'audit-bulk-concurrency@example.invalid',
  '{"display_name":"Bulk concurrency"}'::jsonb
)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values ('94100000-0000-0000-0000-000000000001', 'Bulk concurrency')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.novel_thumbnail_assets (
  id, label, storage_path, image_url, is_active
)
values (
  '94100000-0000-0000-0000-000000000099',
  'Bulk concurrency fixture',
  'official/94100000-0000-0000-0000-000000000099.webp',
  'https://example.invalid/bulk-concurrency.webp',
  true
)
on conflict (id) do nothing;

insert into public.novels (
  id, user_id, title, description, genre, status, pv, ai_usage,
  content_policy_ack, content_policy_version, thumbnail_asset_id
)
overriding system value
values (
  941001,
  '94100000-0000-0000-0000-000000000001',
  'Bulk concurrency fixture',
  'fixture',
  '現代ファンタジー',
  'draft',
  0,
  'human',
  true,
  'beta-2026-08-23',
  '94100000-0000-0000-0000-000000000099'
);

create or replace function public._novelight_bulk_import_abuse_test_pause()
returns trigger
language plpgsql
as $$
begin
  if current_setting('application_name', true) = 'novelight-bulk-abuse-a' then
    perform pg_catalog.pg_sleep(3);
  end if;
  return new;
end
$$;

create trigger novelight_bulk_import_abuse_test_pause
before insert on public.bulk_import_requests
for each row execute function public._novelight_bulk_import_abuse_test_pause();
SQL

set +e
PGAPPNAME=novelight-bulk-abuse-a "${psql_base[@]}" >"$session_a_log" 2>&1 <<'SQL' &
begin;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '94100000-0000-0000-0000-000000000001',
  true
);
select public.novelight_bulk_import_episode_drafts(
  941001,
  '[{"title":"Concurrent","content":"same body"}]'::jsonb
);
commit;
SQL
session_a_pid=$!
set -e

observed_sleep=0
for _ in $(seq 1 50); do
  if "${psql_base[@]}" -Atc \
    "select 1 from pg_stat_activity where application_name = 'novelight-bulk-abuse-a' and wait_event = 'PgSleep';" \
    | grep -q '^1$'; then
    observed_sleep=1
    break
  fi
  sleep 0.1
done

if [[ "$observed_sleep" -ne 1 ]]; then
  cat "$session_a_log"
  echo 'Failed to observe the first import inside the controlled overlap window.' >&2
  kill "$session_a_pid" 2>/dev/null || true
  wait "$session_a_pid" 2>/dev/null || true
  exit 1
fi

set +e
PGAPPNAME=novelight-bulk-abuse-b "${psql_base[@]}" >"$session_b_log" 2>&1 <<'SQL'
begin;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '94100000-0000-0000-0000-000000000001',
  true
);
select public.novelight_bulk_import_episode_drafts(
  941001,
  '[{"title":"Concurrent","content":"same body"}]'::jsonb
);
commit;
SQL
session_b_status=$?
wait "$session_a_pid"
session_a_status=$?
set -e

if [[ "$session_a_status" -ne 0 || "$session_b_status" -eq 0 ]]; then
  cat "$session_a_log"
  cat "$session_b_log"
  echo 'Concurrent identical imports did not resolve to one success and one rejection.' >&2
  exit 1
fi

episode_count=$("${psql_base[@]}" -Atc \
  "select count(*) from public.episodes where novel_id = 941001;")
request_count=$("${psql_base[@]}" -Atc \
  "select count(*) from public.bulk_import_requests where novel_id = 941001;")

if [[ "$episode_count" != '1' || "$request_count" != '1' ]]; then
  cat "$session_a_log"
  cat "$session_b_log"
  echo "Expected one episode and one audit row; found episodes=$episode_count requests=$request_count." >&2
  exit 1
fi

"${psql_base[@]}" <<'SQL'
drop trigger novelight_bulk_import_abuse_test_pause on public.bulk_import_requests;
drop function public._novelight_bulk_import_abuse_test_pause();
delete from public.novels where id = 941001;
delete from public.profiles where id = '94100000-0000-0000-0000-000000000001';
delete from auth.users where id = '94100000-0000-0000-0000-000000000001';
delete from public.novel_thumbnail_assets
where id = '94100000-0000-0000-0000-000000000099';
SQL

echo 'PASS: concurrent identical bulk imports produce one committed request'
