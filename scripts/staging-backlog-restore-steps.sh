#!/usr/bin/env bash
# Run exclusively inside exact-SHA-bound, owner-approved Staging recovery job.
set -euo pipefail
test -n "$STAGING_DATABASE_URL"
test -n "$APPROVED_SHA"
test -n "$STAGING_SUPABASE_URL"
test "$PGSSLMODE" = require
for i in $(seq 0 24); do
  echo "STAGING_BACKLOG_STEP=$((i+1))/25"
  git fetch --no-tags --depth=1 origin main
  test "$(git rev-parse FETCH_HEAD)" = "$APPROVED_SHA"
  node scripts/verify-staging-migration-target.mjs

  psql "$STAGING_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
    -c 'select version::text from supabase_migrations.schema_migrations order by version' \
    > /tmp/novelight-staging-recovery-history.txt
  node scripts/staging-backlog-recovery.mjs verify "$i"

  next="$(node scripts/staging-backlog-recovery.mjs prepare "$i" | jq -r .current)"
  expected="$(jq -r --argjson i "$i" '.immutableMigrations[$i].version' \
    supabase/recovery/staging-backlog-20261011.json)"
  test "$next" = "$expected"

  prechecks="$(find supabase/checks -maxdepth 1 -name "$next*_precheck.sql" -print)"
  test "$(printf '%s\n' "$prechecks" | sed '/^$/d' | wc -l)" -le 1
  if [ -n "$prechecks" ]; then
    psql "$STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
      --single-transaction -f "$prechecks"
  fi
  (cd /tmp/novelight-staging-recovery-project &&
    supabase db push --db-url "$STAGING_DATABASE_URL" --dry-run)
  psql "$STAGING_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
    -c 'select version::text from supabase_migrations.schema_migrations order by version' \
    > /tmp/novelight-staging-recovery-history.txt
  node scripts/staging-backlog-recovery.mjs verify "$i"

  (cd /tmp/novelight-staging-recovery-project &&
    supabase db push --db-url "$STAGING_DATABASE_URL" --yes)

  psql "$STAGING_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
    -c 'select version::text from supabase_migrations.schema_migrations order by version' \
    > /tmp/novelight-staging-recovery-history.txt
  node scripts/staging-backlog-recovery.mjs verify "$((i+1))"
  postchecks="$(find supabase/checks -maxdepth 1 -name "$next*_postcheck.sql" -print)"
  test "$(printf '%s\n' "$postchecks" | sed '/^$/d' | wc -l)" -le 1
  if [ -n "$postchecks" ]; then
    psql "$STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
      --single-transaction -f "$postchecks"
  fi
  echo "STAGING_BACKLOG_VERIFIED=$next"
done
