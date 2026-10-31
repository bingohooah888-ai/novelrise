#!/usr/bin/env bash
set -euo pipefail

: "${PGPASSWORD:=postgres}"
export PGPASSWORD

COMPAT_ADMIN=(psql -h "${PGHOST:-127.0.0.1}" -U "${PGUSER:-postgres}" -d postgres -v ON_ERROR_STOP=1)

"${COMPAT_ADMIN[@]}" <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end
$$;
SQL

# Production already recorded search_card_metadata under the historical
# 20260930153337 timestamp. The replay script still exercises the original
# 20260930210000 test fixture path, so provide that path only inside the CI
# workspace without reintroducing a second repository migration.
SEARCH_CARD_COMPAT_MIGRATION="supabase/migrations/20260930210000_search_card_metadata.sql"
cp supabase/migrations/20260930153337_search_card_metadata.sql "$SEARCH_CARD_COMPAT_MIGRATION"
trap 'rm -f "$SEARCH_CARD_COMPAT_MIGRATION"' EXIT
bash scripts/run-migration-replay.sh
# Rehearse the unpublished follow-list SECURITY DEFINER RPCs only on
# the disposable CI migration replay database (never hosted Supabase).
# Actual Staging execution stays behind the OWNER staging approval gate.
echo "::group::Follow lists private RPC install, role checks and rollback (disposable DB)"
FOLLOW_REPLAY=(
  psql -h "${PGHOST:-127.0.0.1}" -U "${PGUSER:-postgres}"
  -d "${NOVELIGHT_REPLAY_DB:-novelight_migration_replay}" -v ON_ERROR_STOP=1
)
FOLLOW_VERSION=20261031173000_followed_authors_list
"${FOLLOW_REPLAY[@]}" -f "supabase/checks/${FOLLOW_VERSION}_postcheck.sql"
"${FOLLOW_REPLAY[@]}" -f tests/rls/follow-lists-candidate-access.sql
"${FOLLOW_REPLAY[@]}" -f "supabase/rollback/${FOLLOW_VERSION}_rollback.sql"
"${FOLLOW_REPLAY[@]}" -f "supabase/checks/${FOLLOW_VERSION}_precheck.sql"
"${FOLLOW_REPLAY[@]}" -f "supabase/migrations/${FOLLOW_VERSION}.sql"
"${FOLLOW_REPLAY[@]}" -f "supabase/checks/${FOLLOW_VERSION}_postcheck.sql"
"${FOLLOW_REPLAY[@]}" -f tests/rls/follow-lists-candidate-access.sql
"${FOLLOW_REPLAY[@]}" -f "supabase/rollback/${FOLLOW_VERSION}_rollback.sql"
"${FOLLOW_REPLAY[@]}" <<'SQL'
do $follow_list_cleanup$
begin
  if pg_catalog.to_regprocedure('public.novelight_followed_authors(integer,integer)') is not null
    or pg_catalog.to_regprocedure('public.novelight_followers(integer,integer)') is not null
    or pg_catalog.to_regprocedure('public.novelight_follow_counts()') is not null then
    raise exception 'Disposable follow-list RPC cleanup failed';
  end if;
end
$follow_list_cleanup$;
SQL
echo "::endgroup::"
# Exercise SCOUT campaign signup on the disposable replay DB only.
psql -h "${PGHOST:-127.0.0.1}" -U "${PGUSER:-postgres}" \
  -d "${NOVELIGHT_REPLAY_DB:-novelight_migration_replay}" -v ON_ERROR_STOP=1 \
  -f tests/rls/scout-campaign-internal-exclusion.sql
# Phase 2 AI foundation is tested ONLY on this disposable replay database.
echo "::group::Verify disabled AI ledger, service-only roles, and budget limits"
AI_REPLAY=(
  psql -h "${PGHOST:-127.0.0.1}" -U "${PGUSER:-postgres}"
  -d "${NOVELIGHT_REPLAY_DB:-novelight_migration_replay}" -v ON_ERROR_STOP=1
)
"${AI_REPLAY[@]}" -f supabase/checks/20261027120000_novelight_ai_shared_runtime_foundation_postcheck.sql
"${AI_REPLAY[@]}" -f tests/rls/ai-runtime-foundation.sql
echo "::endgroup::"
# Only disposable CI PostgreSQL: the chronological replay already installed
# the candidate SQL. Verify it, roll back while empty, then exercise exact
# precheck, re-install, role access, and final cleanup. Never target hosted DB.
echo "::group::AI consent candidate PostgreSQL install / RLS / rollback (disposable DB)"
AI_CONSENT_VERSION=20261031023000
AI_CONSENT_STEM="${AI_CONSENT_VERSION}_novelight_ai_external_consent"
"${AI_REPLAY[@]}" -f "supabase/checks/${AI_CONSENT_STEM}_postcheck.sql"
"${AI_REPLAY[@]}" -f tests/rls/ai-external-consent-candidate-access.sql
"${AI_REPLAY[@]}" -f "supabase/rollback/${AI_CONSENT_STEM}_rollback.sql"
"${AI_REPLAY[@]}" -f "supabase/checks/${AI_CONSENT_STEM}_precheck.sql"
"${AI_REPLAY[@]}" -f "supabase/migrations/${AI_CONSENT_STEM}.sql"
"${AI_REPLAY[@]}" -f "supabase/checks/${AI_CONSENT_STEM}_postcheck.sql"
"${AI_REPLAY[@]}" -f tests/rls/ai-external-consent-candidate-access.sql
"${AI_REPLAY[@]}" -f tests/rls/ai-external-consent-candidate-behavior.sql
"${AI_REPLAY[@]}" -f "supabase/rollback/${AI_CONSENT_STEM}_rollback.sql"
"${AI_REPLAY[@]}" <<'SQL'
do $ai_consent_disposable_cleanup$
begin
  if pg_catalog.to_regclass('public.novelight_ai_external_processing_consents') is not null
    or pg_catalog.to_regclass('public.novelight_ai_external_consent_action_audit') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_consent_grant(uuid,bigint,text,text)') is not null
    or pg_catalog.to_regprocedure('public.novelight_ai_consent_revoke(uuid,bigint,text)') is not null then
    raise exception 'AI_CONSENT_DISPOSABLE_CLEANUP_FAILED';
  end if;
end;
$ai_consent_disposable_cleanup$;
SQL
echo "::endgroup::"
# The replay uses a separate disposable database, never Production.
# Exercise the newly introduced contest functions on real PostgreSQL before
# returning to existing historical RLS and rollback fixtures. The SQL fixture
# is enclosed in a transaction that always rolls back.
echo "::group::Verify November contest private enrollment on replay DB"
CONTEST_REPLAY=(
  psql -h "${PGHOST:-127.0.0.1}" -U "${PGUSER:-postgres}"
  -d "${NOVELIGHT_REPLAY_DB:-novelight_migration_replay}" -v ON_ERROR_STOP=1
)
"${CONTEST_REPLAY[@]}" -f tests/rls/november-contest-integration.sql
echo "::endgroup::"
# The chronological replay above installed the formal Phase 2 candidate.
# First verify its disabled gate, then remove ONLY the empty Phase 2 schema
# before exercising historical Phase 1 reversible migration contracts.
echo "::group::Community Phase 2 formal migration rollback before Phase 1 replay"
# The historical replay also exercises older author-notes rollback paths,
# so restore Phase 1's canonical columns before restoring its RPC functions.
"${CONTEST_REPLAY[@]}" -f supabase/migrations/20261014052000_community_plaza_phase1.sql
"${CONTEST_REPLAY[@]}" -f supabase/checks/20261014052000_community_plaza_phase1_postcheck.sql
"${CONTEST_REPLAY[@]}" -f supabase/checks/20261023055617_community_plaza_phase2_postcheck.sql
"${CONTEST_REPLAY[@]}" -f supabase/rollback/20261023055617_community_plaza_phase2_board_rollback.sql
"${CONTEST_REPLAY[@]}" -f supabase/checks/20261014052000_community_plaza_phase1_postcheck.sql
echo "::endgroup::"

# Test a real one-statement PostgreSQL DO launch plus its audit row in the
# disposable replay database. This generator never contacts Production.
echo "::group::Verify contest registration atomic SQL (disposable replay)"
NOVELIGHT_DISPOSABLE_CONTEST_REPLAY=1 \
  node tests/november-contest-registration-atomic-replay.mjs \
  | "${CONTEST_REPLAY[@]}"
echo "::endgroup::"

# This review draft never touches a hosted Supabase project. Execute it only
# after a clean historical migration replay in the disposable CI Postgres DB.
# Missing syntax, RLS or grants must fail CI before a formal migration is made.
echo "::group::Community Phase 1 isolated review DDL and role contract"
# Historical rollback/reapply test fixtures rebuild canonical source tables.
# Reapply idempotent community migration against the final restored schema.
"${CONTEST_REPLAY[@]}" -f supabase/migrations/20261014052000_community_plaza_phase1.sql
"${CONTEST_REPLAY[@]}" -f supabase/checks/20261014052000_community_plaza_phase1_postcheck.sql
"${CONTEST_REPLAY[@]}" -f tests/rls/community-plaza-phase1-security.sql
"${CONTEST_REPLAY[@]}" -f tests/rls/community-plaza-phase1-behavior.sql
echo "::endgroup::"
echo "::group::Community Phase 1 reversible schema rollback/reapply on disposable DB"
"${CONTEST_REPLAY[@]}" -f supabase/rollback/20261014052000_community_plaza_phase1_rollback.sql
"${CONTEST_REPLAY[@]}" -f supabase/checks/20261014052000_community_plaza_phase1_postrollback.sql
"${CONTEST_REPLAY[@]}" -f supabase/checks/20261014052000_community_plaza_phase1_precheck.sql
"${CONTEST_REPLAY[@]}" -f supabase/migrations/20261014052000_community_plaza_phase1.sql
"${CONTEST_REPLAY[@]}" -f supabase/checks/20261014052000_community_plaza_phase1_postcheck.sql
"${CONTEST_REPLAY[@]}" -f tests/rls/community-plaza-phase1-security.sql
"${CONTEST_REPLAY[@]}" -f tests/rls/community-plaza-phase1-behavior.sql
echo "::endgroup::"
# The formal Phase 2 migration has been CLI-generated. The review fixtures
# import that exact file, test role contracts, then ROLLBACK without persistence.
# Never apply it to Production from this CI runner.
echo "::group::Community Phase 2 rollback-only board contract (disposable replay)"
"${CONTEST_REPLAY[@]}" -f tests/rls/community-plaza-phase2-review.sql
"${CONTEST_REPLAY[@]}" -f tests/rls/community-plaza-phase2-rollback-review.sql
echo "::endgroup::"

# Exercise the final starless Rank cutover only AFTER the historical
# lifecycle replay and rollback tests that intentionally use the old
# star-rating schema. This runs in a disposable PostgreSQL database.
echo "::group::Verify final starless Rank retirement and evaluator"
"${CONTEST_REPLAY[@]}" -f supabase/migrations/20261027090000_remove_star_ratings_and_schedule_work_ranks.sql
"${CONTEST_REPLAY[@]}" <<'SQL'
do $starless$
begin
  if to_regclass('public.novel_star_ratings') is not null then
    raise exception 'Star-rating schema retirement did not complete';
  end if;
  if to_regprocedure('public.set_novel_star_rating(text,integer)') is not null then
    raise exception 'Retired star rating API still exists';
  end if;
  if public.novelight_rank_absolute_ceiling_v3(50,2) <> 2
     or public.novelight_rank_absolute_ceiling_v3(200,8) <> 3 then
    raise exception 'Reader/favorite absolute floors were changed';
  end if;
  if abs(public.novelight_rank_internal_score_v3(100,100) - 100.0) > 0.00001 then
    raise exception 'Normalized starless Rank score was not installed';
  end if;
end;
$starless$;
SQL
echo "::endgroup::"

rm -f "$SEARCH_CARD_COMPAT_MIGRATION"
trap - EXIT

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
run_sql supabase/checks/20260920152733_free_two_novel_limit_precheck.sql
run_sql supabase/migrations/20260920152733_free_two_novel_limit.sql
run_sql supabase/checks/20260920152733_free_two_novel_limit_postcheck.sql
run_sql supabase/checks/20261013030000_free_five_novel_limit_precheck.sql
run_sql supabase/migrations/20261013030000_free_five_novel_limit.sql
run_sql supabase/checks/20261013030000_free_five_novel_limit_postcheck.sql
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
run_sql supabase/rollback/20261013030000_free_five_novel_limit_rollback.sql
run_sql supabase/checks/20261013030000_free_five_novel_limit_precheck.sql
run_sql supabase/rollback/20260920152733_free_two_novel_limit_rollback.sql
run_sql supabase/checks/20260920152733_free_two_novel_limit_precheck.sql
run_sql supabase/rollback/20260823073000_enforce_billing_permissions_and_novel_limits_rollback.sql
run_sql tests/rls/billing-rollback.sql
run_sql supabase/rollback/20260822194000_manage_content_write_rls_rollback.sql
run_sql tests/rls/write-rollback.sql
