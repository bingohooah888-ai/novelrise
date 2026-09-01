#!/usr/bin/env bash
set -euo pipefail

: "${PGPASSWORD:=postgres}"
export PGPASSWORD

bash scripts/run-migration-replay.sh

DB=(psql -h "${PGHOST:-127.0.0.1}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-novelight_test}" -v ON_ERROR_STOP=1)

run_sql() {
  echo "::group::$1"
  "${DB[@]}" -f "$1"
  echo "::endgroup::"
}

run_sql tests/rls/fixture.sql
run_sql supabase/migrations/20260819190000_secure_content_rls_and_constraints.sql
run_sql supabase/checks/20260822_content_write_rls_precheck.sql
run_sql supabase/migrations/20260822194000_manage_content_write_rls.sql
run_sql tests/rls/billing-fixture.sql
run_sql supabase/checks/20260823073000_billing_permissions_and_novel_limits_precheck.sql
run_sql supabase/migrations/20260823073000_enforce_billing_permissions_and_novel_limits.sql
run_sql supabase/checks/20260823074300_stripe_subscription_state_precheck.sql
run_sql supabase/migrations/20260823074300_add_stripe_subscription_state.sql
run_sql supabase/checks/20260830214000_checkout_attempt_reservations_precheck.sql
run_sql supabase/migrations/20260830214000_checkout_attempt_reservations.sql
run_sql tests/rls/checkout-attempt-reservations.sql
bash tests/rls/checkout-attempt-concurrency.sh
run_sql tests/rls/read-access.sql
run_sql tests/rls/write-access.sql
run_sql tests/rls/billing-and-plan-limits.sql
run_sql tests/rls/stripe-lifecycle-columns.sql
bash tests/rls/plan-limit-concurrency.sh
run_sql tests/rls/light-seed-fixture.sql
run_sql supabase/checks/20260823083500_light_seed_mvp_precheck.sql
run_sql supabase/migrations/20260823083500_light_seed_mvp.sql
run_sql tests/rls/light-seed-mvp.sql
bash tests/rls/light-seed-concurrency.sh
run_sql tests/rls/exposure-fixture.sql
run_sql supabase/checks/20260823112000_exposure_allocation_precheck.sql
run_sql supabase/migrations/20260823112000_exposure_allocation.sql
run_sql tests/rls/exposure-allocation.sql
run_sql supabase/checks/20260823115300_exposure_funnel_precheck.sql
run_sql supabase/migrations/20260823115300_exposure_funnel.sql
run_sql tests/rls/exposure-funnel.sql
run_sql supabase/checks/20260823133000_exposure_funnel_retention_precheck.sql
run_sql supabase/migrations/20260823133000_exposure_funnel_retention.sql
run_sql tests/rls/exposure-funnel-retention.sql
run_sql supabase/checks/20260823133000_exposure_funnel_retention_postcheck.sql
run_sql supabase/checks/20260828223000_harden_profile_favorite_reads_and_discovery_precheck.sql
run_sql supabase/migrations/20260828223000_harden_profile_favorite_reads_and_discovery.sql
run_sql supabase/migrations/20260828224000_author_basic_metrics.sql
run_sql tests/rls/profile-favorite-privacy.sql
run_sql supabase/checks/20260828223000_harden_profile_favorite_reads_and_discovery_postcheck.sql
run_sql tests/rls/pv-counting-fixture.sql
run_sql supabase/checks/20260901130000_harden_pv_counting_precheck.sql
run_sql supabase/migrations/20260901130000_harden_pv_counting.sql
run_sql tests/rls/pv-counting.sql
bash tests/rls/pv-counting-concurrency.sh
run_sql supabase/checks/20260901130000_harden_pv_counting_postcheck.sql
run_sql supabase/rollback/20260901130000_harden_pv_counting_rollback.sql
run_sql tests/rls/pv-counting-rollback.sql
run_sql supabase/rollback/20260828224000_author_basic_metrics_rollback.sql
run_sql supabase/rollback/20260828223000_harden_profile_favorite_reads_and_discovery_rollback.sql
run_sql tests/rls/profile-favorite-privacy-rollback.sql
run_sql supabase/rollback/20260823133000_exposure_funnel_retention_rollback.sql
run_sql tests/rls/exposure-funnel-retention-rollback.sql
run_sql supabase/checks/20260822_content_write_rls_postcheck.sql
run_sql supabase/checks/20260823073000_billing_permissions_and_novel_limits_postcheck.sql
run_sql supabase/checks/20260823074300_stripe_subscription_state_postcheck.sql
run_sql supabase/checks/20260830214000_checkout_attempt_reservations_postcheck.sql
run_sql supabase/checks/20260823083500_light_seed_mvp_postcheck.sql
run_sql supabase/checks/20260823112000_exposure_allocation_postcheck.sql
run_sql supabase/checks/20260823115300_exposure_funnel_postcheck.sql
run_sql supabase/rollback/20260823115300_exposure_funnel_rollback.sql
run_sql tests/rls/exposure-funnel-rollback.sql
run_sql supabase/rollback/20260823112000_exposure_allocation_rollback.sql
run_sql tests/rls/exposure-rollback.sql
run_sql supabase/rollback/20260823083500_light_seed_mvp_rollback.sql
run_sql tests/rls/light-seed-rollback.sql
run_sql supabase/rollback/20260830214000_checkout_attempt_reservations_rollback.sql
run_sql tests/rls/checkout-attempt-reservations-rollback.sql
run_sql supabase/rollback/20260823074300_add_stripe_subscription_state_rollback.sql
run_sql tests/rls/stripe-lifecycle-rollback.sql
run_sql supabase/rollback/20260823073000_enforce_billing_permissions_and_novel_limits_rollback.sql
run_sql tests/rls/billing-rollback.sql
run_sql supabase/rollback/20260822194000_manage_content_write_rls_rollback.sql
run_sql tests/rls/write-rollback.sql
