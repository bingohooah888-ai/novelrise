#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${SUPABASE_PROJECT_ID:?SUPABASE_PROJECT_ID is required}"

sql_file="${1:-supabase/checks/production_initial_schema_baseline_state.sql}"
result_file="${2:-/tmp/production-initial-baseline-state.json}"

jq -Rs '{query: .}' "$sql_file" > /tmp/production-initial-baseline-query.json

curl --fail-with-body --silent --show-error \
  --request POST \
  --url "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/database/query/read-only" \
  --header "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  --header 'Content-Type: application/json' \
  --data-binary @/tmp/production-initial-baseline-query.json \
  > "$result_file"

if ! jq -e '
  (if type == "array" then .[0]
   elif (.result? | type) == "array" then .result[0]
   else . end) as $row
  | $row.ok == true
    and $row.profiles_exists == true
    and $row.novels_exists == true
    and $row.episodes_exists == true
    and $row.favorites_exists == true
' "$result_file" >/dev/null; then
  echo 'Production initial baseline state check failed.'
  jq '
    (if type == "array" then .[0]
     elif (.result? | type) == "array" then .result[0]
     else . end)
    | {
        ok,
        profiles_exists,
        novels_exists,
        episodes_exists,
        favorites_exists
      }
  ' "$result_file"
  exit 1
fi

echo 'Production initial baseline state check passed: all four historical core tables exist.'
