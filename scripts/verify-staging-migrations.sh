#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
output_file="${2:-/tmp/staging-migration-list.txt}"

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
}

show_migration_list() {
  require_staging_database
  supabase migration list --db-url "$STAGING_DATABASE_URL" | tee "$output_file"
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
    show_migration_list

    find supabase/migrations -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.sql' -printf '%f\n' \
      | sed -E 's/^([0-9]{14})_.*/\1/' \
      | sort -u \
      > /tmp/staging-local-migrations.txt

    if [ ! -s /tmp/staging-local-migrations.txt ]; then
      echo 'Staging migration parity blocked: no local migrations were found.'
      exit 1
    fi

    bash scripts/extract-supabase-remote.sh "$output_file" \
      > /tmp/staging-remote-migrations.txt

    if ! diff -u /tmp/staging-local-migrations.txt /tmp/staging-remote-migrations.txt; then
      echo 'Staging migration parity blocked: remote history does not exactly match the repository.'
      exit 1
    fi

    echo "Verified exact Staging/repository migration parity: $(wc -l < /tmp/staging-local-migrations.txt | tr -d ' ') migrations."
    ;;

  *)
    echo 'Usage: verify-staging-migrations.sh {artifacts|pending|parity} [output-file]'
    exit 2
    ;;
esac
