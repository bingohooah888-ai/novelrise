#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-novelight_test}"

psql_base=(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1)

session_a_log=$(mktemp)
session_b_log=$(mktemp)
cleanup() {
  rm -f "$session_a_log" "$session_b_log"
}
trap cleanup EXIT

PGAPPNAME=novelight-plan-limit-a "${psql_base[@]}" >"$session_a_log" 2>&1 <<'SQL' &
begin;
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '66666666-6666-6666-6666-666666666666',
  false
);
insert into public.novels (id, user_id, status) values (
  '60000000-0000-0000-0000-000000000001',
  '66666666-6666-6666-6666-666666666666',
  'published'
);
select pg_sleep(3);
commit;
SQL
session_a_pid=$!

observed_sleep=0
for _ in $(seq 1 50); do
  if "${psql_base[@]}" -Atc \
    "select 1 from pg_stat_activity where application_name = 'novelight-plan-limit-a' and query like '%pg_sleep%';" \
    | grep -q '^1$'; then
    observed_sleep=1
    break
  fi
  sleep 0.1
done

if [[ "$observed_sleep" -ne 1 ]]; then
  cat "$session_a_log"
  echo 'Failed to observe session A holding the free-author transaction open.' >&2
  kill "$session_a_pid" 2>/dev/null || true
  wait "$session_a_pid" 2>/dev/null || true
  exit 1
fi

set +e
PGAPPNAME=novelight-plan-limit-b "${psql_base[@]}" >"$session_b_log" 2>&1 <<'SQL'
begin;
set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '66666666-6666-6666-6666-666666666666',
  false
);
insert into public.novels (id, user_id, status) values (
  '60000000-0000-0000-0000-000000000002',
  '66666666-6666-6666-6666-666666666666',
  'published'
);
commit;
SQL
session_b_status=$?
set -e

wait "$session_a_pid"

if [[ "$session_b_status" -eq 0 ]]; then
  cat "$session_b_log"
  echo 'Concurrent second Free-plan insert unexpectedly succeeded.' >&2
  exit 1
fi

count=$("${psql_base[@]}" -Atc \
  "select count(*) from public.novels where user_id = '66666666-6666-6666-6666-666666666666';")

if [[ "$count" != '1' ]]; then
  cat "$session_a_log"
  cat "$session_b_log"
  echo "Expected one novel after concurrent Free-plan inserts, found $count." >&2
  exit 1
fi

echo 'PASS: concurrent Free-plan inserts cannot exceed the database limit'
