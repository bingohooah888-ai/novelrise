#!/usr/bin/env bash
# Generate a review-only migration candidate locally. Never applies SQL.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v supabase >/dev/null || { echo 'Supabase CLI required' >&2; exit 1; }
supabase migration new --help >/dev/null
source_sql='reports/sql/novelight_ai_review_candidates_PROPOSAL.sql'
test -f "$source_sql"
test -d supabase/migrations
before="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort)"
supabase migration new ai_review_candidates
after="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort)"
created="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after"))"
test "$(printf '%s\n' "$created" | sed '/^$/d' | wc -l)" -eq 1 || {
  echo 'Expected exactly one generated migration; inspect manually' >&2
  exit 1
}
case "$created" in
  supabase/migrations/*_ai_review_candidates.sql) ;;
  *) echo 'Unexpected generated migration name' >&2; exit 1 ;;
esac
cp "$source_sql" "$created"
echo "Review candidate created: $created"
echo 'STOP: Do not merge, apply or sync without separate OWNER approval.'
