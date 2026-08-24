#!/usr/bin/env bash
set -euo pipefail

: "${CHANGED_VERSIONS:?CHANGED_VERSIONS is required}"

output_file="${1:-/tmp/migration-list.txt}"

supabase migration list --linked | tee "$output_file"

printf '%s\n' "$CHANGED_VERSIONS" \
  | tr ',' '\n' \
  | sed '/^$/d' \
  | sort -u \
  > /tmp/expected-pending.txt

awk -F '│' '
  {
    local=$1
    remote=$2
    gsub(/[^0-9]/, "", local)
    gsub(/[^0-9]/, "", remote)
    if (length(local) == 14 && length(remote) == 0) print local
  }
' "$output_file" \
  | sort -u \
  > /tmp/actual-pending.txt

echo 'Expected pending migrations:'
cat /tmp/expected-pending.txt
echo 'Actual pending migrations:'
cat /tmp/actual-pending.txt

if ! diff -u /tmp/expected-pending.txt /tmp/actual-pending.txt; then
  echo 'Production pending migrations do not exactly match the approved change set.'
  exit 1
fi
