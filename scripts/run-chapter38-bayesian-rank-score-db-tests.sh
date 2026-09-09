#!/usr/bin/env bash
set -euo pipefail

: "${PGPASSWORD:=postgres}"
export PGPASSWORD
DB=(psql -h "${PGHOST:-127.0.0.1}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-novelight_test}" -v ON_ERROR_STOP=1)

run_sql() {
  echo "::group::$1"
  "${DB[@]}" -f "$1"
  echo "::endgroup::"
}

# This companion gate runs after scripts/run-beta-p0-db-tests.sh has built and
# exercised the Chapter 38 work Rank lifecycle. The score migration itself does
# not mutate Rank state, so its rollback remains safe even with lifecycle fixture
# evidence already present.
run_sql supabase/checks/20260909130000_chapter38_rank_bayesian_percentiles_precheck.sql
run_sql supabase/migrations/20260909130000_chapter38_rank_bayesian_percentiles.sql
run_sql supabase/checks/20260909130000_chapter38_rank_bayesian_percentiles_postcheck.sql
run_sql supabase/rollback/20260909130000_chapter38_rank_bayesian_percentiles_rollback.sql
run_sql supabase/checks/20260909130000_chapter38_rank_bayesian_percentiles_precheck.sql
run_sql supabase/migrations/20260909130000_chapter38_rank_bayesian_percentiles.sql
run_sql supabase/checks/20260909130000_chapter38_rank_bayesian_percentiles_postcheck.sql
run_sql tests/rls/work-rank-bayesian-percentiles.sql
run_sql supabase/checks/20260909140000_chapter38_seed_discovery_exp_precheck.sql
run_sql supabase/migrations/20260909140000_chapter38_seed_discovery_exp.sql
run_sql supabase/checks/20260909140000_chapter38_seed_discovery_exp_postcheck.sql
run_sql supabase/rollback/20260909140000_chapter38_seed_discovery_exp_rollback.sql
run_sql supabase/checks/20260909140000_chapter38_seed_discovery_exp_precheck.sql
run_sql supabase/migrations/20260909140000_chapter38_seed_discovery_exp.sql
run_sql supabase/checks/20260909140000_chapter38_seed_discovery_exp_postcheck.sql
run_sql tests/rls/seed-discovery-exp.sql
