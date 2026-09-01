#!/usr/bin/env bash
set -euo pipefail

: "${PGPASSWORD:=postgres}"
export PGPASSWORD

DB_HOST="${PGHOST:-127.0.0.1}"
DB_PORT="${PGPORT:-5432}"
DB_USER="${PGUSER:-postgres}"
DB_NAME="${PGDATABASE:-novelight_test}"
EPISODE_ID="22000000-0000-0000-0000-000000000001"
NOVEL_ID="20000000-0000-0000-0000-000000000001"
TOKEN="pv-concurrency-reader"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

initial_novel_pv="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Atc \
  "select pv from public.novels where id = '$NOVEL_ID'::uuid")"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
delete from public.episode_pv_events
where episode_id_snapshot = '$EPISODE_ID';
update public.episodes set pv = 0 where id = '$EPISODE_ID'::uuid;
SQL

for i in $(seq 1 10); do
  (
    set +e
    psql \
      -h "$DB_HOST" \
      -p "$DB_PORT" \
      -U "$DB_USER" \
      -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 \
      >"$workdir/$i.log" 2>&1 <<SQL
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select public.record_episode_pv('$EPISODE_ID', '$TOKEN');
SQL
    echo "$?" >"$workdir/$i.status"
  ) &
done

wait

for i in $(seq 1 10); do
  status="$(cat "$workdir/$i.status")"
  if [ "$status" -ne 0 ]; then
    echo "Unexpected PV concurrency failure for request $i:" >&2
    cat "$workdir/$i.log" >&2
    exit 1
  fi
done

final_episode_pv="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Atc \
  "select pv from public.episodes where id = '$EPISODE_ID'::uuid")"
final_novel_pv="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Atc \
  "select pv from public.novels where id = '$NOVEL_ID'::uuid")"
event_count="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Atc \
  "select count(*) from public.episode_pv_events where viewer_key_hash = md5('visitor:' || '$TOKEN') and episode_id_snapshot = '$EPISODE_ID'")"

if [ "$final_episode_pv" -ne 1 ]; then
  echo "Expected exactly one concurrent episode PV count; got $final_episode_pv" >&2
  exit 1
fi

if [ "$final_novel_pv" -ne $((initial_novel_pv + 1)) ]; then
  echo "Expected work PV to increase exactly once; before=$initial_novel_pv after=$final_novel_pv" >&2
  exit 1
fi

if [ "$event_count" -ne 1 ]; then
  echo "Expected one PV audit event for concurrent duplicate calls; got $event_count" >&2
  exit 1
fi

echo "PASS: concurrent duplicate PV calls produce exactly one atomic count"
