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

PGAPPNAME=novelight-checkout-reservation-a "${psql_base[@]}" >"$session_a_log" 2>&1 <<'SQL' &
begin;
set role service_role;
select attempt_id
from public.novelight_reserve_checkout_attempt(
  '66666666-6666-6666-6666-666666666666',
  'standard',
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
);
select pg_sleep(3);
commit;
SQL
session_a_pid=$!

observed_sleep=0
for _ in $(seq 1 50); do
  if "${psql_base[@]}" -Atc \
    "select 1 from pg_stat_activity where application_name = 'novelight-checkout-reservation-a' and query like '%pg_sleep%';" \
    | grep -q '^1$'; then
    observed_sleep=1
    break
  fi
  sleep 0.1
done

if [[ "$observed_sleep" -ne 1 ]]; then
  cat "$session_a_log"
  echo 'Failed to observe session A holding the Checkout reservation transaction open.' >&2
  kill "$session_a_pid" 2>/dev/null || true
  wait "$session_a_pid" 2>/dev/null || true
  exit 1
fi

PGAPPNAME=novelight-checkout-reservation-b "${psql_base[@]}" >"$session_b_log" 2>&1 <<'SQL'
begin;
set role service_role;
select attempt_id
from public.novelight_reserve_checkout_attempt(
  '66666666-6666-6666-6666-666666666666',
  'standard',
  'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
);
commit;
SQL

wait "$session_a_pid"

if ! grep -q 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' "$session_b_log"; then
  cat "$session_a_log"
  cat "$session_b_log"
  echo 'Concurrent Checkout reservation did not reuse the first durable attempt.' >&2
  exit 1
fi

count=$("${psql_base[@]}" -Atc \
  "select count(*) from public.billing_checkout_attempts where user_id = '66666666-6666-6666-6666-666666666666';")

if [[ "$count" != '1' ]]; then
  cat "$session_a_log"
  cat "$session_b_log"
  echo "Expected one durable Checkout attempt after concurrency test, found $count." >&2
  exit 1
fi

"${psql_base[@]}" -c \
  "delete from public.billing_checkout_attempts where user_id = '66666666-6666-6666-6666-666666666666';" \
  >/dev/null

echo 'PASS: concurrent Checkout reservations serialize to one durable attempt'
