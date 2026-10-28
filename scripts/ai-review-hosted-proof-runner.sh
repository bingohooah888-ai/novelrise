#!/usr/bin/env bash
# DORMANT until reviewed and included in a trusted-main, OWNER-gated runner.
# This script is not an approval or a workflow. NEVER run from the Draft PR.
# Database-only synthetic identities have no passwords and cannot prove JWT.
set -euo pipefail
umask 077

[[ "${NOVELIGHT_STAGING_AI_RACE_ADMITTED:-}" == "1" ]] || {
  echo 'DENIED: missing dedicated one-time Staging race admission' >&2
  exit 1
}
[[ "${STAGING_PROJECT_REF:-}" == "wmlzjgvxgoyrovdhbqbg" ]] || exit 1
[[ "${APPROVED_MAIN_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ "${APPROVED_CANDIDATE_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ "${STAGING_APPROVAL_COMMENT_ID:-}" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "$(git rev-parse HEAD)" == "$APPROVED_MAIN_SHA" ]] || {
  echo 'DENIED: untrusted checkout; only pinned main may run with secrets' >&2
  exit 1
}
[[ "${STAGING_SUPABASE_URL:-}" ==   "https://wmlzjgvxgoyrovdhbqbg.supabase.co" ]] || exit 1
[[ -n "${STAGING_DATABASE_URL_FILE:-}" &&   -s "$STAGING_DATABASE_URL_FILE" ]] || exit 1

# The existing trusted target verifier checks pooler project and credential URL.
export STAGING_DATABASE_URL
STAGING_DATABASE_URL="$(cat "$STAGING_DATABASE_URL_FILE")"
export PGSSLMODE=require
node scripts/verify-staging-migration-target.mjs

scratch="$(mktemp -d)"
chmod 700 "$scratch"
owner='00000000-0000-4000-8000-000000000941'
other='00000000-0000-4000-8000-000000000942'
novel=998891001
episode=998891002
fixture_committed=0
finished=0
pa=''
pb=''

psql_call() {
  psql "$STAGING_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 "$@"
}
census() {
  node scripts/ai-review-hosted-proof-census.mjs sql > "$scratch/census.sql"
  psql_call -f "$scratch/census.sql" > "$scratch/census.json"
  STAGING_PROJECT_REF="$STAGING_PROJECT_REF"     node scripts/ai-review-hosted-proof-census.mjs assert "$scratch/census.json"
}
# Audit every actual FK referencing synthetic auth/profile/novel/episode IDs.
# For each FK, a nonzero residual aborts the proof. No broad user data dumps.
foreign_key_residue() {
  psql_call > "$scratch/fk-residual-queries.sql" <<SQL
SELECT format(
  'SELECT %L AS fk_name, count(*) AS remaining FROM %I.%I WHERE %I %s;',
  k.conname, n.nspname, c.relname, a.attname,
  CASE
    WHEN k.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
      THEN 'IN (''$owner''::uuid, ''$other''::uuid)'
    WHEN k.confrelid = 'public.novels'::regclass THEN '= $novel'
    ELSE '= $episode'
  END
)
FROM pg_constraint k
JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN LATERAL unnest(k.conkey) WITH ORDINALITY ck(attnum, pos) ON true
JOIN LATERAL unnest(k.confkey) WITH ORDINALITY fk(attnum, pos)
  ON fk.pos = ck.pos
JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ck.attnum
JOIN pg_attribute ref_a
  ON ref_a.attrelid = k.confrelid AND ref_a.attnum = fk.attnum
WHERE k.contype = 'f' AND ref_a.attname = 'id'
  AND k.confrelid IN (
    'auth.users'::regclass, 'public.profiles'::regclass,
    'public.novels'::regclass, 'public.episodes'::regclass
  )
ORDER BY 1;
SQL
  psql_call -f "$scratch/fk-residual-queries.sql" > "$scratch/fk-residuals.txt" ||
    return 1
  [[ -s "$scratch/fk-residuals.txt" ]] || return 1
  awk -F '|' 'NF != 2 || $2 != "0" { failed=1 }
    END { exit failed ? 1 : 0 }' "$scratch/fk-residuals.txt"
}
cleanup() {
  local rc="$?"
  trap - EXIT
  if [[ -n "$pa" ]]; then kill "$pa" 2>/dev/null || true; fi
  if [[ -n "$pb" ]]; then kill "$pb" 2>/dev/null || true; fi
  if [[ "$fixture_committed" == 1 ]]; then
    # No wildcard delete. A failure here is never hidden or auto-retried.
    if ! psql_call > "$scratch/cleanup.log" 2>&1 <<SQL
BEGIN;
SET LOCAL statement_timeout='12s';
SET LOCAL lock_timeout='3s';
DELETE FROM public.novelight_ai_review_candidates
  WHERE actor_id IN ('$owner', '$other')
    AND novel_id = $novel;
DELETE FROM public.episodes WHERE id = $episode
  AND novel_id = $novel AND user_id = '$owner';
DELETE FROM public.novels WHERE id = $novel AND user_id = '$owner';
DELETE FROM auth.users WHERE id IN ('$owner', '$other')
  AND lower(email) IN ('ai-review-owner@example.invalid',
                      'ai-review-other@example.invalid');
COMMIT;
SQL
    then
      echo 'STAGING_RACE_CLEANUP_FAILED: manual review required; no retry' >&2
      rc=1
    elif ! census > /dev/null || ! foreign_key_residue; then
      echo 'STAGING_RACE_RESIDUE: synthetic FK or fixture residue; manual review' >&2
      rc=1
    fi
  fi
  if [[ "$fixture_committed" == 0 ]] && ! census > /dev/null; then
    echo 'STAGING_RACE_AMBIGUOUS_SETUP: inspect Staging before any retry' >&2
    rc=1
  fi
  if [[ "$finished" == 1 && "$rc" == 0 ]]; then
    echo 'STAGING_RACE_PASS: 2 sessions, CAS, full fixture cleanup verified'
  else
    rc=1
  fi
  rm -rf "$scratch"
  unset STAGING_DATABASE_URL
  exit "$rc"
}
trap cleanup EXIT

# This census includes all 25 audited Auth/profile/novel/episode triggers,
# exact migration and zero AI budgets, and reserved fixture collisions.
census

# Both identities predate Beta/SCOUT; all novel and chapter content is
# fictional, unpublished and private. No actual Auth sign-in is attempted.
psql_call > "$scratch/setup.log" 2>&1 <<SQL
BEGIN;
SET LOCAL statement_timeout='12s';
SET LOCAL lock_timeout='3s';
INSERT INTO auth.users(id, email, created_at, updated_at)
VALUES
  ('$owner', 'ai-review-owner@example.invalid',
   '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
  ('$other', 'ai-review-other@example.invalid',
   '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');
INSERT INTO public.novels(id,user_id,title,status)
VALUES ($novel,'$owner','Synthetic AI candidate race proof','draft');
INSERT INTO public.episodes
  (id,novel_id,user_id,episode_number,title,content,status)
VALUES
  ($episode,$novel,'$owner',1,'Synthetic evidence',
   'Fictional blue key evidence marker.','draft');
COMMIT;
SQL
fixture_committed=1

hash="$(psql_call -c "select encode(
  extensions.digest(convert_to(
    '[' || to_json(title)::text || ',' || to_json(content)::text || ']',
    'UTF8'), 'sha256'), 'hex')
  from public.episodes where id=$episode and novel_id=$novel")"
node_hash="$(node -e "process.stdout.write(require('node:crypto').createHash('sha256').update(JSON.stringify(['Synthetic evidence','Fictional blue key evidence marker.'])).digest('hex'))")"
[[ "$hash" == "$node_hash" ]] || {
  echo 'STAGING_RACE_DENIED: different SQL/Node source hashes' >&2
  exit 1
}
stage_sql="public.novelight_ai_review_stage_batch('$owner',$novel,$episode,'$hash',repeat('a',64),'[{\"kind\":\"other\",\"key\":\"Synthetic\",\"summary\":\"Synthetic evidence only\",\"evidence\":\"blue key\"}]'::jsonb)"

# Observe an actual second PG backend blocked by the first transaction.
PGAPPNAME=novelight-ai-race-a psql_call > "$scratch/a.log" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE service_role;
SELECT $stage_sql;
SELECT pg_sleep(3);
COMMIT;
SQL
pa="$!"
seen=0
for _ in $(seq 1 60); do
  if psql_call -c "select 1 from pg_stat_activity
    where application_name='novelight-ai-race-a'
      and state='active' and query like '%pg_sleep%'" | grep -qx 1; then
    seen=1
    break
  fi
  sleep 0.05
done
[[ "$seen" == 1 ]] || { echo 'STAGING_RACE_DENIED: first session not observed' >&2; exit 1; }

PGAPPNAME=novelight-ai-race-b psql_call > "$scratch/b.log" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE service_role;
SELECT $stage_sql;
COMMIT;
SQL
pb="$!"
seen=0
for _ in $(seq 1 60); do
  if psql_call -c "select 1 from pg_stat_activity
    where application_name='novelight-ai-race-b'
      and wait_event_type='Lock'" | grep -qx 1; then
    seen=1
    break
  fi
  sleep 0.05
done
[[ "$seen" == 1 ]] || { echo 'STAGING_RACE_DENIED: lock wait not observed' >&2; exit 1; }
wait "$pa"; pa=''
wait "$pb"; pb=''
grep -qx 1 "$scratch/a.log"
grep -qx 0 "$scratch/b.log"
[[ "$(psql_call -c "select count(*) from public.novelight_ai_review_candidates where novel_id=$novel")" == 1 ]]

candidate="$(psql_call -c "select id from public.novelight_ai_review_candidates where novel_id=$novel and actor_id='$owner'")"
[[ "$candidate" =~ ^[1-9][0-9]*$ ]] || exit 1
decide_sql="public.novelight_ai_review_decide('$owner',$novel,$candidate,'$hash',1,'accepted')"

PGAPPNAME=novelight-ai-decide-a psql_call > "$scratch/decision-a.log" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE service_role;
SELECT status || ':' || revision FROM $decide_sql;
SELECT pg_sleep(3);
COMMIT;
SQL
pa="$!"
seen=0
for _ in $(seq 1 60); do
  if psql_call -c "select 1 from pg_stat_activity
    where application_name='novelight-ai-decide-a'
      and state='active' and query like '%pg_sleep%'" | grep -qx 1; then
    seen=1
    break
  fi
  sleep 0.05
done
[[ "$seen" == 1 ]] || exit 1
PGAPPNAME=novelight-ai-decide-b psql_call > "$scratch/decision-b.log" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE service_role;
SELECT count(*) FROM public.novelight_ai_review_decide(
  '$owner',$novel,$candidate,'$hash',1,'rejected');
COMMIT;
SQL
pb="$!"
wait "$pa"; pa=''
if wait "$pb"; then
  grep -qx 0 "$scratch/decision-b.log"
else
  # The DB denies scope if the row changed during the wait.
  grep -q 'Review scope denied' "$scratch/decision-b.log"
fi
pb=''
grep -qx 'accepted:2' "$scratch/decision-a.log"
[[ "$(psql_call -c "select status || ':' || revision from public.novelight_ai_review_candidates where id=$candidate")" == 'accepted:2' ]]

# The chapter-edit race must invalidate old candidate evidence.
psql_call -c "set role service_role; select
  public.novelight_ai_review_stage_batch(
  '$owner',$novel,$episode,'$hash',repeat('b',64),
  '[{\"kind\":\"other\",\"key\":\"SyntheticB\",\"summary\":\"Draft-only rival\",\"evidence\":\"blue key\"}]'::jsonb
  )" > "$scratch/stage-batch-2.log"
second="$(psql_call -c "select id from public.novelight_ai_review_candidates where novel_id=$novel and fact_key='SyntheticB'")"
[[ "$second" =~ ^[1-9][0-9]*$ ]] || exit 1
PGAPPNAME=novelight-ai-edit-a psql_call > "$scratch/edit-a.log" 2>&1 <<SQL &
BEGIN;
SET LOCAL statement_timeout='15s';
UPDATE public.episodes SET content='Edited fictional key evidence.' WHERE id=$episode;
SELECT pg_sleep(3);
COMMIT;
SQL
pa="$!"
seen=0
for _ in $(seq 1 60); do
  if psql_call -c "select 1 from pg_stat_activity
    where application_name='novelight-ai-edit-a'
      and state='active' and query like '%pg_sleep%'" | grep -qx 1; then
    seen=1
    break
  fi
  sleep 0.05
done
[[ "$seen" == 1 ]] || exit 1
PGAPPNAME=novelight-ai-edit-b psql_call -v VERBOSITY=verbose > "$scratch/edit-b.log" 2>&1 <<SQL &
SET ROLE service_role;
SELECT count(*) FROM public.novelight_ai_review_decide(
  '$owner',$novel,$second,'$hash',1,'accepted');
SQL
pb="$!"
wait "$pa"; pa=''
if wait "$pb"; then
  echo 'STAGING_RACE_DENIED: stale manuscript approval succeeded' >&2
  exit 1
fi
pb=''
grep -q 22023 "$scratch/edit-b.log"
[[ "$(psql_call -c "select status || ':' || revision from public.novelight_ai_review_candidates where id=$second")" == 'pending:1' ]]

new_hash="$(psql_call -c "select encode(
  extensions.digest(convert_to(
    '[' || to_json(title)::text || ',' || to_json(content)::text || ']',
    'UTF8'), 'sha256'), 'hex')
  from public.episodes where id=$episode and novel_id=$novel")"
expect_state() {
  local expected="$1" sql="$2"
  if psql_call -v VERBOSITY=verbose -c "$sql" > "$scratch/denied.log" 2>&1; then
    echo 'STAGING_RACE_DENIED: expected a security or integrity refusal' >&2
    exit 1
  fi
  grep -q "$expected" "$scratch/denied.log" || {
    echo 'STAGING_RACE_DENIED: unexpected SQLSTATE' >&2
    exit 1
  }
}
expect_state 42501 "set role service_role; select
  public.novelight_ai_review_stage_batch(
  '$other',$novel,$episode,'$new_hash',repeat('c',64),
  '[{\"kind\":\"other\",\"key\":\"Foreign\",\"summary\":\"Denied\",\"evidence\":\"fictional\"}]'::jsonb)"
expect_state 22023 "set role service_role; select
  public.novelight_ai_review_stage_batch(
  '$owner',$novel,$episode,'$new_hash',repeat('c',64),
  '[{\"kind\":\"other\",\"key\":\"Forgery\",\"summary\":\"Denied\",\"evidence\":\"not in manuscript\"}]'::jsonb)"
expect_state 42501 "set role authenticated; select
  public.novelight_ai_review_stage_batch(
  '$owner',$novel,$episode,'$new_hash',repeat('c',64),
  '[{\"kind\":\"other\",\"key\":\"Browser\",\"summary\":\"Denied\",\"evidence\":\"fictional\"}]'::jsonb)"
expect_state 42501 "set role anon; select
  public.novelight_ai_review_stage_batch(
  '$owner',$novel,$episode,'$new_hash',repeat('c',64),
  '[{\"kind\":\"other\",\"key\":\"Guest\",\"summary\":\"Denied\",\"evidence\":\"fictional\"}]'::jsonb)"
psql_call > "$scratch/rollback.log" 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.novelight_ai_review_stage_batch(
  '$owner',$novel,$episode,'$new_hash',repeat('d',64),
  '[{"kind":"other","key":"RolledBack","summary":"Draft-only rollback","evidence":"fictional"}]'::jsonb
);
ROLLBACK;
SQL
[[ "$(psql_call -c "select count(*) from public.novelight_ai_review_candidates where actor_id='$owner' and request_hash=repeat('d',64)")" == 0 ]]
[[ "$(psql_call -c "select count(*) from public.novelight_ai_review_candidates where novel_id=$novel")" == 2 ]]

# A real signed JWT is a separate, Preview-scoped approval and test.
# This proof does not fake a hosted token or turn on the AI feature.
finished=1
