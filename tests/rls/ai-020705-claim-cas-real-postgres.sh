#!/usr/bin/env bash
# Real two-session claim/CAS proof on the EXISTING disposable CI PostgreSQL.
# Never connect to Supabase Staging or Production. No service provisioning.
set -euo pipefail

HOST="${PGHOST:-127.0.0.1}"
PORT="${PGPORT:-5432}"
USER="${PGUSER:-postgres}"
if [[ "$GITHUB_ACTIONS" != true || "$CI" != true ||
      "$HOST" != 127.0.0.1 || "$PORT" != 5432 ||
      "$USER" != postgres ]]; then
  echo 'AI_020705_DISPOSABLE_CI_PG_REQUIRED' >&2
  exit 1
fi
export PGPASSWORD="${PGPASSWORD:-postgres}"
DB=novelight_ai_020705_claim_disposable
OWNER=11111111-1111-4111-8111-111111111111
OTHER=22222222-2222-4222-8222-222222222222
FINGERPRINT=$(printf 'b%.0s' {1..64})
OTHER_FP=$(printf 'd%.0s' {1..64})
CHUNK_HASH=$(printf 'c%.0s' {1..64})
OTHER_CHUNK_HASH=$(printf 'e%.0s' {1..64})
TITLE='第一話🌟「扉」'
CONTENT=$'凛は"鍵"を持った。\\古い路地。\n次の行で、雨が降る。'
SOURCE=$(TITLE="$TITLE" CONTENT="$CONTENT" node -p \
  "require('node:crypto').createHash('sha256').update(JSON.stringify([process.env.TITLE,process.env.CONTENT])).digest('hex')")

admin() { psql -X -q -A -t -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U "$USER" -d postgres "$@"; }
dbsql() { psql -X -q -A -t -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" "$@"; }
created=false
changed_role=false
tmpfile=''
cleanup() {
  local rc=$?
  trap - EXIT
  if [[ -n "$tmpfile" ]]; then rm -f "$tmpfile"; fi
  if [[ "$created" == true ]]; then
    admin -c "DROP DATABASE $DB WITH (FORCE);" >/dev/null || rc=1
  fi
  if [[ "$changed_role" == true ]]; then
    admin -c 'ALTER ROLE service_role NOBYPASSRLS;' >/dev/null || rc=1
  fi
  exit "$rc"
}
trap cleanup EXIT

[[ $(admin -c "SELECT count(*) FROM pg_database WHERE datname='$DB';") == 0 ]] || {
  echo 'Refusing pre-existing disposable DB' >&2
  exit 1
}
admin -c "CREATE DATABASE $DB;" >/dev/null
created=true

dbsql <<SQL
DO \$roles\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END \$roles\$;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE public.novels(id bigint PRIMARY KEY,user_id uuid NOT NULL);
CREATE TABLE public.episodes(
 id bigint PRIMARY KEY,
 novel_id bigint NOT NULL REFERENCES public.novels(id),
 title text NOT NULL,content text NOT NULL
);
CREATE TABLE public.novelight_ai_episode_analysis(
 episode_id bigint PRIMARY KEY REFERENCES public.episodes(id),
 source_hash text NOT NULL,
 revision integer NOT NULL DEFAULT 1,
 summary jsonb NOT NULL DEFAULT '{}'::jsonb,
 analyzed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.novels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.novelight_ai_episode_analysis ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.novels,public.episodes,
 public.novelight_ai_episode_analysis FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA public,extensions TO service_role;
GRANT SELECT,UPDATE ON TABLE public.novels,public.episodes TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.novelight_ai_episode_analysis TO service_role;
GRANT EXECUTE ON FUNCTION extensions.digest(bytea,text) TO service_role;
INSERT INTO public.novels VALUES (41,'$OWNER'::uuid);
SQL
dbsql -v title="$TITLE" -v content="$CONTENT" <<'SQL'
INSERT INTO public.episodes VALUES (11,41,:'title',:'content');
SQL

if [[ $(admin -c "SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role';") != t ]]; then
  # CI-only emulation of the real Supabase service_role BYPASSRLS.
  admin -c 'ALTER ROLE service_role BYPASSRLS;' >/dev/null
  changed_role=true
fi

PG_HASH=$(dbsql -c "SELECT encode(extensions.digest(convert_to(
  '[' || to_json(title)::text || ',' || to_json(content)::text || ']',
  'UTF8'),'sha256'),'hex')
  FROM public.episodes WHERE id=11;")
[[ "$SOURCE" == "$PG_HASH" ]] || {
  echo 'FAIL: Node/PostgreSQL manuscript hash mismatch' >&2
  exit 1
}
echo 'PASS: UTF-8, quotes, backslashes, newlines and Unicode hash parity'

# Apply the EXACT current PR SQL proposals only inside the isolated CI DB.
dbsql -f reports/sql/novelight_ai_checkpoint_cas_v1_PROPOSAL.sql >/dev/null
dbsql -f reports/sql/novelight_ai_checkpoint_claim_once_v1_PROPOSAL.sql >/dev/null

ACL=$(dbsql <<'SQL'
SELECT (SELECT relrowsecurity FROM pg_class
        WHERE oid='public.novelight_ai_chunk_claims'::regclass)
  AND NOT has_table_privilege('anon','public.novelight_ai_chunk_claims','SELECT')
  AND NOT has_table_privilege('authenticated','public.novelight_ai_chunk_claims','INSERT')
  AND has_table_privilege('service_role','public.novelight_ai_chunk_claims','INSERT')
  AND NOT has_function_privilege('anon',
    'public.novelight_ai_checkpoint_claim_once_v1(uuid,bigint,bigint,text,text,text,integer,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.novelight_ai_checkpoint_cas_v1(uuid,bigint,bigint,text,text,integer,text,text,jsonb,integer)','EXECUTE');
SQL
)
[[ "$ACL" == t ]] || {
  echo 'FAIL: RLS / service-only grants' >&2
  exit 1
}
echo 'PASS: claim table RLS and ACL; public/reader RPC denied'

claim_call() {
  local actor="$1" fp="$2" chunk_hash="$3"
  printf "public.novelight_ai_checkpoint_claim_once_v1('%s'::uuid,41,11,'%s',NULL,'%s',0,'%s')" \
    "$actor" "$SOURCE" "$fp" "$chunk_hash"
}
CLAIM=$(claim_call "$OWNER" "$FINGERPRINT" "$CHUNK_HASH")
FOREIGN_CLAIM=$(claim_call "$OTHER" "$FINGERPRINT" "$CHUNK_HASH")
# Error must specifically be owner denied, not a generic SQL failure.
if dbsql -c "SET ROLE service_role; SELECT $FOREIGN_CLAIM;" >/dev/null 2>&1; then
  echo 'FAIL: foreign actor admitted' >&2
  exit 1
fi
echo 'PASS: foreign actor denied'

race() {
  local label="$1" expr="$2" expected_first="$3" expected_second="$4"
  local first_result second_result first_pid start_ms elapsed_ms ready=false
  tmpfile=$(mktemp)
  (
    dbsql <<SQL
BEGIN;
SET ROLE service_role;
SELECT $expr;
\echo RACE_FIRST_HOLDING
SELECT pg_sleep(2);
COMMIT;
SQL
  ) >"$tmpfile" 2>&1 &
  first_pid=$!
  for _ in {1..120}; do
    if grep -q '^RACE_FIRST_HOLDING$' "$tmpfile"; then
      ready=true
      break
    fi
    if ! kill -0 "$first_pid" 2>/dev/null; then break; fi
    sleep .05
  done
  if [[ "$ready" != true ]]; then
    wait "$first_pid" || true
    echo "FAIL: $label first transaction not ready" >&2
    exit 1
  fi
  grep -qx "$expected_first" "$tmpfile" || {
    echo "FAIL: $label first result" >&2
    exit 1
  }
  start_ms=$(date +%s%3N)
  second_result=$(dbsql -c "SET ROLE service_role; SELECT $expr;")
  elapsed_ms=$(( $(date +%s%3N) - start_ms ))
  wait "$first_pid"
  [[ "$second_result" == "$expected_second" ]] || {
    echo "FAIL: $label second result" >&2
    exit 1
  }
  (( elapsed_ms >= 500 )) || {
    echo "FAIL: $label transactions did not overlap / block" >&2
    exit 1
  }
  echo "PASS: $label two PostgreSQL connections, first=$expected_first, second=$expected_second, lock_wait_ms=$elapsed_ms"
  rm -f "$tmpfile"
  tmpfile=''
}

race claim_once "$CLAIM" t f
REPLAY_CLAIM=$(claim_call "$OWNER" "$OTHER_FP" "$OTHER_CHUNK_HASH")
[[ $(dbsql -c "SET ROLE service_role; SELECT $REPLAY_CLAIM;") == f ]] || {
  echo 'FAIL: changed fingerprint bypasses spent claim' >&2
  exit 1
}
[[ $(dbsql -c 'SELECT count(*) FROM public.novelight_ai_chunk_claims;') == 1 ]] || {
  echo 'FAIL: claim ledger expected one row' >&2
  exit 1
}
echo 'PASS: fingerprint/chunk-hash replan cannot produce second paid claim'

NEXT=$(printf "jsonb_build_object('version',1,'state','complete','actorId','%s','novelId',41,'episodeId',11,'previousSourceHash',NULL,'targetSourceHash','%s','fingerprint','%s','chunkCount',1,'completedIndices',jsonb_build_array(0))" \
  "$OWNER" "$SOURCE" "$FINGERPRINT")
CAS="(SELECT count(*) FROM public.novelight_ai_checkpoint_cas_v1('$OWNER'::uuid,41,11,'record','$SOURCE',NULL,NULL,'$SOURCE',$NEXT,0))"
race checkpoint_cas "$CAS" 1 0
[[ $(dbsql -c "SELECT source_hash FROM public.novelight_ai_episode_analysis WHERE episode_id=11;") == "$SOURCE" ]] || {
  echo 'FAIL: checkpoint source not persisted' >&2
  exit 1
}
[[ $(dbsql -c "SET ROLE service_role; SELECT $CLAIM;") == f ]] || {
  echo 'FAIL: completed checkpoint replay' >&2
  exit 1
}
echo 'PASS: CAS recorded exactly one checkpoint, completed replay rejected'
# Targeted preventive Gate A proof; same disposable database and no hosted I/O.
dbsql -f tests/rls/ai-020705-gatea-preventive.sql
echo 'PASS: all tests on existing disposable CI PostgreSQL; no hosted database touched'
