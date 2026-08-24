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

if ! jq -e '
  (if type == "array" then .[0]
   elif (.result? | type) == "array" then .result[0]
   else . end) as $row
  | $row.ok == true
' "$result_file" >/dev/null; then
  echo 'Production beta observability checks failed.'
  jq '
    (if type == "array" then .[0]
     elif (.result? | type) == "array" then .result[0]
     else . end)
    | {
        ok,
        signup_name_migration_applied,
        profile_names_present,
        acquisition_claims_present,
        acquisition_rows_valid,
        lifecycle_rows_present,
        lifecycle_rows_valid,
        recent_activity_present,
        activity_rows_valid,
        acquisition_has_lifecycle,
        acquisition_tokens_hashed
      }
  ' "$result_file"
  exit 1
fi

echo 'Production beta observability checks passed.'
