#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${SUPABASE_PROJECT_ID:?SUPABASE_PROJECT_ID is required}"

sql_file="${1:-supabase/checks/production_beta_observability.sql}"
result_file="${2:-/tmp/production-beta-result.json}"

jq -Rs '{query: .}' "$sql_file" > /tmp/production-beta-query.json

curl --fail-with-body --silent --show-error \
  --request POST \
  --url "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/database/query/read-only" \
  --header "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  --header 'Content-Type: application/json' \
  --data-binary @/tmp/production-beta-query.json \
  > "$result_file"

node scripts/evaluate-production-observability.mjs "$result_file"
