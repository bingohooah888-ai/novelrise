#!/usr/bin/env bash
set -euo pipefail

: "${PGPASSWORD:=postgres}"
export PGPASSWORD

DB_HOST="${PGHOST:-127.0.0.1}"
DB_PORT="${PGPORT:-5432}"
DB_USER="${PGUSER:-postgres}"
DB_NAME="${PGDATABASE:-novelight_test}"
READER_ID="44444444-4444-4444-4444-444444444444"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

for i in $(seq 11 21); do
  novel_id="70000000-0000-0000-0000-$(printf '%012d' "$i")"
  (
    set +e
    psql \
      -h "$DB_HOST" \
      -p "$DB_PORT" \
      -U "$DB_USER" \
      -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 \
      >"$workdir/$i.log" 2>&1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '$READER_ID', false);
select public.plant_light_seed('$novel_id');
SQL
    echo "$?" >"$workdir/$i.status"
  ) &
done

wait

successes=0
failures=0
for i in $(seq 11 21); do
  status="$(cat "$workdir/$i.status")"
  if [ "$status" -eq 0 ]; then
    successes=$((successes + 1))
  else
    failures=$((failures + 1))
    if ! grep -q "Monthly LIGHT SEED limit reached" "$workdir/$i.log"; then
      echo "Unexpected LIGHT SEED concurrency failure for request $i:" >&2
      cat "$workdir/$i.log" >&2
      exit 1
    fi
  fi
done

if [ "$successes" -ne 10 ] || [ "$failures" -ne 1 ]; then
  echo "Expected 10 successful and 1 rejected concurrent LIGHT SEED calls; got $successes success / $failures failure" >&2
  for i in $(seq 11 21); do
    echo "--- request $i ---" >&2
    cat "$workdir/$i.log" >&2
  done
  exit 1
fi

psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 <<SQL
select public.test_assert(
  (select count(*) = 10
   from public.light_seeds
   where reader_id = '$READER_ID'::uuid
     and seed_month = date_trunc('month', timezone('Asia/Tokyo', now()))::date),
  'concurrent calls must never create more than ten monthly LIGHT SEED rows'
);
SQL

echo "PASS: concurrent LIGHT SEED requests remain capped at ten"
