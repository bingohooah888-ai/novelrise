#!/usr/bin/env bash
# LOCAL-ONLY helper. Creates a candidate migration file using the installed
# Supabase CLI; never connects to Production/Staging or applies any SQL.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
branch_name="$(git branch --show-current)"
if [[ -z "$branch_name" || "$branch_name" == main ]]; then
  echo 'Refusing to generate a migration on main or detached HEAD.' >&2
  exit 1
fi
if ! command -v supabase >/dev/null 2>&1; then
  echo 'Supabase CLI is not available. No migration was generated.' >&2
  exit 2
fi

source_sql=docs/community/phase2-board-schema-review.sql
test -f "$source_sql" || { echo "Missing $source_sql" >&2; exit 1; }
grep -q 'REVIEW-ONLY' "$source_sql" || {
  echo 'Unexpected Phase 2 SQL input; refusing to generate.' >&2
  exit 1
}

# Do not duplicate a prior CLI-generated migration; never guess timestamps.
if find supabase/migrations -maxdepth 1 -name '*_community_plaza_phase2_board.sql' -print -quit | grep -q .; then
  echo 'An existing Phase 2 migration candidate must be reviewed first.' >&2
  exit 1
fi

supabase --version >&2
supabase migration new --help >/dev/null
supabase migration new community_plaza_phase2_board < "$source_sql"

output="$(find supabase/migrations -maxdepth 1 -name '*_community_plaza_phase2_board.sql' -print)"
if [[ -z "$output" || "$output" == *$'\n'* || ! -f "$output" ]]; then
  echo 'CLI output not uniquely identified; inspect generated files manually.' >&2
  exit 1
fi
cmp -s "$source_sql" "$output" || {
  echo 'Generated migration differs from reviewed SQL; inspect the diff.' >&2
  exit 1
}
printf 'Created via Supabase CLI: %s\n' "$output"
echo 'Candidate only. Do not merge, deploy, or apply until OWNER safety approvals.'
