#!/usr/bin/env bash
# CI ONLY: two independent PostgreSQL sessions on disposable replay DB.
# Never connect this script to Supabase Staging or Production.
set -euo pipefail

: "${NOVELIGHT_AI_REVIEW_DISPOSABLE:=}"
: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
: "${NOVELIGHT_REPLAY_DB:=novelight_migration_replay}"
export PGPASSWORD
if [[ "$NOVELIGHT_AI_REVIEW_DISPOSABLE" != "1" ||
      "$PGHOST" != "127.0.0.1" ||
      "$NOVELIGHT_REPLAY_DB" != "novelight_migration_replay" ]]; then
  echo 'REFUSED: only the explicit disposable, loopback replay DB is allowed.' >&2
  exit 1
fi

psql_call() {
  psql -X -qAt -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" \
    -U "$PGUSER" -d "$NOVELIGHT_REPLAY_DB" "$@"
}
tmp="$(mktemp -d)"
owner='00000000-0000-4000-8000-000000000941'
other='00000000-0000-4000-8000-000000000942'
novel=998891001
episode=998891002
pa=''
pb=''
cleanup() {
  if [[ -n "$pa" ]]; then kill "$pa" 2>/dev/null || true; fi
  if [[ -n "$pb" ]]; then kill "$pb" 2>/dev/null || true; fi
  psql_call > /dev/null 2>&1 <<SQL || true
delete from public.novelight_ai_review_candidates where novel_id=$novel;
delete from public.episodes where id=$episode;
delete from public.novels where id=$novel;
delete from auth.users where id in ('$owner', '$other');
SQL
  # Return the disposable CI role to its historical simulation state.
  psql_call -c 'revoke usage on schema extensions from service_role' >/dev/null 2>&1 || true
  psql_call -c 'alter role service_role with nobypassrls' >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

# Supabase's actual Staging service_role has rolbypassrls=true; the
# replay harness creates a plain nologin role. Mirror it ONLY in this
# isolated disposable DB, then restore that role during cleanup.
psql_call -c 'alter role service_role with bypassrls' >/dev/null
# The hosted Supabase role also has USAGE on the pgcrypto extensions schema.
psql_call -c 'grant usage on schema extensions to service_role' >/dev/null

psql_call <<SQL
insert into auth.users(id,email) values
  ('$owner','ai-review-owner@example.invalid'),
  ('$other','ai-review-other@example.invalid')
on conflict (id) do nothing;
insert into public.novels(id,user_id,title,status)
  values ($novel,'$owner','AI synthetic test novel','draft');
insert into public.episodes(id,novel_id,user_id,episode_number,title,content,status)
  values ($episode,$novel,'$owner',1,'AI synthetic title',
  'Synthetic evidence marker lives here.','draft');
SQL

source_hash="$(psql_call -c "
select pg_catalog.encode(
  extensions.digest(pg_catalog.convert_to(
    '[' || pg_catalog.to_json(title)::text || ',' ||
    pg_catalog.to_json(content)::text || ']', 'UTF8'
  ),'sha256'),'hex') from public.episodes where id=$episode")"
node_hash="$(node -e "const h=require('node:crypto').createHash('sha256');process.stdout.write(h.update(JSON.stringify(['AI synthetic title','Synthetic evidence marker lives here.'])).digest('hex'))")"
if [[ "$source_hash" != "$node_hash" ]]; then
  echo 'FAIL: PostgreSQL and Node chapter hashes differ' >&2
  exit 1
fi
batch='[{"kind":"character","key":"Hero","summary":"Synthetic protagonist","evidence":"evidence marker"}]'
function_stage="public.novelight_ai_review_stage_batch('$owner',$novel,$episode,'$source_hash',repeat('a',64),'$batch'::jsonb)"

wait_for_activity() {
  local app="$1" condition="$2" observed=0
  for _ in $(seq 1 80); do
    if psql_call -c "select 1 from pg_stat_activity where application_name='$app' and $condition" |
      grep -qx 1; then
      observed=1
      break
    fi
    sleep 0.05
  done
  if [[ "$observed" != "1" ]]; then
    echo "FAIL: expected two-session state for $app ($condition)" >&2
    for log in "$tmp"/*.log; do cat "$log" >&2; done
    exit 1
  fi
}

# Identical concurrent request hash: A holds its advisory lock until commit.
PGAPPNAME=ai-review-stage-a psql_call > "$tmp/stage-a.log" 2>&1 <<SQL &
begin;
set local role service_role;
select $function_stage;
select pg_sleep(3);
commit;
SQL
pa=$!
wait_for_activity ai-review-stage-a "state='active' and query like '%pg_sleep%'"

PGAPPNAME=ai-review-stage-b psql_call > "$tmp/stage-b.log" 2>&1 <<SQL &
begin;
set local role service_role;
select $function_stage;
commit;
SQL
pb=$!
wait_for_activity ai-review-stage-b "wait_event_type='Lock'"
wait "$pa"; pa=''
wait "$pb"; pb=''
grep -qx 1 "$tmp/stage-a.log"
grep -qx 0 "$tmp/stage-b.log"
count="$(psql_call -c "select count(*) from public.novelight_ai_review_candidates where novel_id=$novel")"
[[ "$count" == "1" ]] || { echo "FAIL: duplicate batch inserted $count rows" >&2; exit 1; }

candidate="$(psql_call -c "select id from public.novelight_ai_review_candidates where novel_id=$novel and fact_key='Hero'")"
decision="public.novelight_ai_review_decide('$owner',$novel,$candidate,'$source_hash',1,'accepted')"
reverse_decision="public.novelight_ai_review_decide('$owner',$novel,$candidate,'$source_hash',1,'rejected')"

# Two decisions on the same revision: one can commit; the other cannot.
PGAPPNAME=ai-review-decision-a psql_call > "$tmp/decision-a.log" 2>&1 <<SQL &
begin;
set local role service_role;
select status || ':' || revision from $decision;
select pg_sleep(3);
commit;
SQL
pa=$!
wait_for_activity ai-review-decision-a "state='active' and query like '%pg_sleep%'"
PGAPPNAME=ai-review-decision-b psql_call -v VERBOSITY=verbose > "$tmp/decision-b.log" 2>&1 <<SQL &
begin;
set local role service_role;
select count(*) from $reverse_decision;
commit;
SQL
pb=$!
wait_for_activity ai-review-decision-b "wait_event_type='Lock'"
wait "$pa"; pa=''
if wait "$pb"; then
  grep -qx 0 "$tmp/decision-b.log"
else
  grep -q 42501 "$tmp/decision-b.log"
fi
pb=''
grep -qx 'accepted:2' "$tmp/decision-a.log"
status="$(psql_call -c "select status || ':' || revision from public.novelight_ai_review_candidates where id=$candidate")"
[[ "$status" == 'accepted:2' ]] || { echo "FAIL: revision race: $status" >&2; exit 1; }

# An episode edit committed before the attempted decision invalidates its hash.
psql_call -c "set role service_role; select public.novelight_ai_review_stage_batch('$owner',$novel,$episode,'$source_hash',repeat('b',64),'[{\"kind\":\"character\",\"key\":\"Rival\",\"summary\":\"Synthetic rival\",\"evidence\":\"evidence marker\"}]'::jsonb);" >"$tmp/second-stage.log"
second="$(psql_call -c "select id from public.novelight_ai_review_candidates where novel_id=$novel and fact_key='Rival'")"
PGAPPNAME=ai-review-edit-a psql_call > "$tmp/edit-a.log" 2>&1 <<SQL &
begin;
update public.episodes set content='Synthetic edited chapter.' where id=$episode;
select pg_sleep(3);
commit;
SQL
pa=$!
wait_for_activity ai-review-edit-a "state='active' and query like '%pg_sleep%'"
PGAPPNAME=ai-review-edit-b psql_call -v VERBOSITY=verbose > "$tmp/edit-b.log" 2>&1 <<SQL &
set role service_role;
select count(*) from public.novelight_ai_review_decide(
  '$owner',$novel,$second,'$source_hash',1,'accepted');
SQL
pb=$!
wait_for_activity ai-review-edit-b "wait_event_type='Lock'"
wait "$pa"; pa=''
if wait "$pb"; then
  echo 'FAIL: stale chapter decision succeeded' >&2; exit 1
fi
pb=''
grep -q 22023 "$tmp/edit-b.log"
second_status="$(psql_call -c "select status || ':' || revision from public.novelight_ai_review_candidates where id=$second")"
[[ "$second_status" == 'pending:1' ]] || { echo 'FAIL: stale decision changed candidate' >&2; exit 1; }

# SQLSTATE and privilege denials, with no side effects.
expect_error() {
  local state="$1" query="$2"
  if psql_call -v VERBOSITY=verbose -c "$query" > "$tmp/denied.log" 2>&1; then
    echo "FAIL: SQLSTATE $state expected but query succeeded" >&2
    exit 1
  fi
  grep -q "$state" "$tmp/denied.log" || {
    cat "$tmp/denied.log" >&2
    echo "FAIL: expected SQLSTATE $state" >&2
    exit 1
  }
}
new_hash="$(psql_call -c "
select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
 '[' || pg_catalog.to_json(title)::text || ',' || pg_catalog.to_json(content)::text || ']',
 'UTF8'),'sha256'),'hex') from public.episodes where id=$episode")"
expect_error 42501 "set role service_role; select public.novelight_ai_review_stage_batch('$other',$novel,$episode,'$new_hash',repeat('c',64),'$batch'::jsonb)"
expect_error 22023 "set role service_role; select public.novelight_ai_review_stage_batch('$owner',$novel,$episode,'$new_hash',repeat('c',64),'[{\"kind\":\"other\",\"key\":\"Fake\",\"summary\":\"No proof\",\"evidence\":\"missing source quote\"}]'::jsonb)"
expect_error 42501 "set role anon; select public.novelight_ai_review_stage_batch('$owner',$novel,$episode,'$new_hash',repeat('c',64),'$batch'::jsonb)"
expect_error 42501 "set role authenticated; select public.novelight_ai_review_decide('$owner',$novel,$second,'$new_hash',1,'accepted')"

# Aborted batch never leaves committed candidate rows behind.
psql_call > "$tmp/rollback.log" <<SQL
begin;
set local role service_role;
select public.novelight_ai_review_stage_batch('$owner',$novel,$episode,
  '$new_hash',repeat('d',64),
  '[{"kind":"other","key":"Rollback","summary":"Synthetic rollback","evidence":"Synthetic edited"}]'::jsonb);
rollback;
SQL
remaining="$(psql_call -c "select count(*) from public.novelight_ai_review_candidates where actor_id='$owner' and request_hash=repeat('d',64)")"
[[ "$remaining" == 0 ]] || { echo 'FAIL: transaction rollback persisted candidate' >&2; exit 1; }
[[ "$(psql_call -c "select count(*) from public.novelight_ai_review_candidates where novel_id=$novel")" == 2 ]]
echo 'PASS: real two-session stage race, revision race, edit race, permissions and rollback on disposable DB'
