#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
output_file="${2:-/tmp/staging-migration-list.txt}"
# Fixed, already-applied SCOUT migration history for the dedicated Staging project.
STAGING_SCOUT_REF='wmlzjgvxgoyrovdhbqbg'
STAGING_ONLY_DIR='supabase/staging-migrations'
STAGING_ONLY_FILES=(
  '20261110080421_formal_scout_level_staging_2762_20261110.sql'
  '20261111095412_scout_formal_point_usage_private5_20261111.sql'
  '20261111103051_scout_formal_earnings_private4_20261111.sql'
  '20261111104317_scout_formal_earning_functions_only_20261111.sql'
)


canonical_expected() {
  : "${EXPECTED_MIGRATIONS:?EXPECTED_MIGRATIONS is required}"

  printf '%s\n' "$EXPECTED_MIGRATIONS" \
    | tr ',' '\n' \
    | sed '/^$/d' \
    > /tmp/staging-expected-raw.txt

  count="$(wc -l < /tmp/staging-expected-raw.txt | tr -d ' ')"
  if [ "$count" -lt 1 ] || [ "$count" -gt 20 ]; then
    echo 'Staging migration sync blocked: expected migration count must be between 1 and 20.'
    exit 1
  fi

  while IFS= read -r version; do
    if ! [[ "$version" =~ ^[0-9]{14}$ ]]; then
      echo "Staging migration sync blocked: invalid migration version $version."
      exit 1
    fi
  done < /tmp/staging-expected-raw.txt

  sort -u /tmp/staging-expected-raw.txt > /tmp/staging-expected.txt
  canonical="$(paste -sd, /tmp/staging-expected.txt)"
  if [ "$canonical" != "$EXPECTED_MIGRATIONS" ]; then
    echo 'Staging migration sync blocked: EXPECTED_MIGRATIONS must be sorted, unique, and canonical.'
    exit 1
  fi
}

require_staging_database() {
  if [ -z "${STAGING_DATABASE_URL:-}" ]; then
    echo 'Staging migration sync blocked: STAGING_DATABASE_URL is required.' >&2
    exit 1
  fi
  if [ "${PGSSLMODE:-}" != 'require' ]; then
    echo 'Staging migration sync blocked: PGSSLMODE must be exactly require.' >&2
    exit 1
  fi
  if [ "${STAGING_SUPABASE_URL%/}" != "https://${STAGING_SCOUT_REF}.supabase.co" ]; then
    echo 'Staging migration sync blocked: Staging-only history requires the dedicated Staging project.' >&2
    exit 1
  fi
}

show_migration_list() {
  require_staging_database
  supabase migration list --db-url "$STAGING_DATABASE_URL" | tee "$output_file"
}


require_staging_only_files() {
  test -d "$STAGING_ONLY_DIR" || {
    echo 'Staging migration sync blocked: approved Staging-only folder is missing.' >&2
    exit 1
  }
  local count
  count="$(find "$STAGING_ONLY_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
  if [ "$count" -ne 4 ]; then
    echo 'Staging migration sync blocked: Staging-only folder must contain exactly four files.' >&2
    exit 1
  fi
  local filename
  for filename in "${STAGING_ONLY_FILES[@]}"; do
    if [ ! -f "$STAGING_ONLY_DIR/$filename" ] || [ -L "$STAGING_ONLY_DIR/$filename" ]; then
      echo 'Staging migration sync blocked: approved Staging-only SQL missing or symlinked.' >&2
      exit 1
    fi
  done
}

prove_staging_only_history() {
  require_staging_database
  require_staging_only_files
  local filename version name digest bytes matched
  for filename in "${STAGING_ONLY_FILES[@]}"; do
    version="${filename:0:14}"
    name="${filename:15:${#filename}-19}"
    digest="$(sha256sum "$STAGING_ONLY_DIR/$filename" | cut -d' ' -f1)"
    bytes="$(wc -c < "$STAGING_ONLY_DIR/$filename" | tr -d ' ')"
    matched="$(psql "$STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -c "SELECT count(*)=1 FROM supabase_migrations.schema_migrations WHERE version::text='${version}' AND name::text='${name}' AND cardinality(statements)=1 AND encode(sha256(convert_to(statements[1], 'UTF8')), 'hex')='${digest}' AND octet_length(statements[1])=${bytes};")"
    if [ "$matched" != 't' ]; then
      echo "Staging migration sync blocked: approved Staging-only SQL/name/hash mismatch at $version." >&2
      exit 1
    fi
  done
  echo 'Verified the four Staging-only migration histories read-only.'
}

prepare_staging_only() {
  prove_staging_only_history
  local filename version
  for filename in "${STAGING_ONLY_FILES[@]}"; do
    version="${filename:0:14}"
    if compgen -G "supabase/migrations/${version}_*.sql" > /dev/null; then
      echo "Staging migration sync blocked: Staging-only version $version exists in Production migration folder." >&2
      exit 1
    fi
  done
  # Copies exist only in this disposable Staging runner, never in Git main.
  for filename in "${STAGING_ONLY_FILES[@]}"; do
    cp -- "$STAGING_ONLY_DIR/$filename" "supabase/migrations/$filename"
  done
  echo 'Materialized four Staging-only history files in the ephemeral Staging runner.'
}

case "$mode" in
  artifacts)
    canonical_expected
    manifest_file="${2:-/tmp/staging-migration-artifacts.txt}"
    : > "$manifest_file"
    shopt -s nullglob

    while IFS= read -r version; do
      migrations=(supabase/migrations/"${version}"_*.sql)
      prechecks=(supabase/checks/"${version}"_*_precheck.sql)
      postchecks=(supabase/checks/"${version}"_*_postcheck.sql)
      rollbacks=(supabase/rollback/"${version}"_*_rollback.sql)

      if [ "${#migrations[@]}" -ne 1 ]; then
        echo "Staging migration sync blocked: expected exactly one migration artifact for $version."
        exit 1
      fi
      if [ "${#prechecks[@]}" -ne 1 ]; then
        echo "Staging migration sync blocked: expected exactly one precheck artifact for $version."
        exit 1
      fi
      if [ "${#postchecks[@]}" -ne 1 ]; then
        echo "Staging migration sync blocked: expected exactly one postcheck artifact for $version."
        exit 1
      fi
      if [ "${#rollbacks[@]}" -ne 1 ]; then
        echo "Staging migration sync blocked: expected exactly one rollback artifact for $version."
        exit 1
      fi

      printf '%s|%s|%s|%s|%s\n' \
        "$version" \
        "${migrations[0]}" \
        "${prechecks[0]}" \
        "${postchecks[0]}" \
        "${rollbacks[0]}" \
        >> "$manifest_file"
    done < /tmp/staging-expected.txt

    echo "Verified Staging migration artifacts for $EXPECTED_MIGRATIONS."
    ;;

  prepare-staging-only)
    prepare_staging_only
    ;;

  pending)
    canonical_expected
    show_migration_list
    bash scripts/extract-supabase-remote.sh "$output_file" \
      > /tmp/staging-validated-remote.txt
    bash scripts/extract-supabase-pending.sh "$output_file" \
      > /tmp/staging-actual-pending.txt

    echo 'Expected Staging pending migrations:'
    cat /tmp/staging-expected.txt
    echo 'Actual Staging pending migrations:'
    cat /tmp/staging-actual-pending.txt

    if ! diff -u /tmp/staging-expected.txt /tmp/staging-actual-pending.txt; then
      echo 'Staging migration sync blocked: pending migrations do not exactly match the requested set.'
      exit 1
    fi
    ;;


  parity)
    prove_staging_only_history
    for filename in "${STAGING_ONLY_FILES[@]}"; do
      if ! cmp -s "$STAGING_ONLY_DIR/$filename" "supabase/migrations/$filename"; then
        echo 'Staging migration parity blocked: ephemeral SQL differs from approved source.' >&2
        exit 1
      fi
    done
    show_migration_list
    find supabase/migrations -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.sql' -printf '%f\n' \
      | sed -E 's/^([0-9]{14})_.*/\1/' | sort -u > /tmp/staging-local-migrations.txt
    if [ ! -s /tmp/staging-local-migrations.txt ]; then
      echo 'Staging migration parity blocked: no local migrations were found.'
      exit 1
    fi
    bash scripts/extract-supabase-remote.sh "$output_file" > /tmp/staging-remote-migrations.txt
    if ! diff -u /tmp/staging-local-migrations.txt /tmp/staging-remote-migrations.txt; then
      echo 'Staging migration parity blocked: history differs from Production-track plus four approved Staging-only versions.'
      exit 1
    fi
    echo "Verified strict Staging migration parity: $(wc -l < /tmp/staging-local-migrations.txt | tr -d ' ') approved migrations."
    ;;

  *)
    echo 'Usage: verify-staging-migrations.sh {artifacts|prepare-staging-only|pending|parity} [output-file]'
    exit 2
    ;;
esac
