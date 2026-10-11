# NOVELIGHT Staging migration drift — recovery assessment (2026-10-11)

> Evidence snapshot, **not an execution authorization**. Recheck latest main,
> both live migration histories, and safety contracts before any changes.
> docs/STAGING-MIGRATION-SYNC.md remains authoritative.

## Observed release blocker

- Discovery-card PR #2069 is merged. Migration safety files merged in PR #2073.
- Repository: **158** migration versions. Production: **157** applied; precisely
  **one pending**: 20261011160000_public_discovery_card_state.sql.
- Dedicated Staging project wmlzjgvxgoyrovdhbqbg: **133** applied migrations,
  **26 repo versions absent** and an additional history entry
  20260930210000_search_card_metadata. The repository instead contains
  20260930153337_search_card_metadata.sql.
- The existing public search-card function definition's Postgres MD5 matched
  on Production and Staging: f913180101c8cd35744e51d34db1c55e.
  This is NOT proof of full SQL equivalence: grants, role ownership,
  comments, dependencies, and other effects need separate review.
- Read-only catalog comparison found at least **11 public tables,
  133 columns and 35 public function signatures** on Production but missing
  on Staging. In particular, Staging lacks episodes.first_published_at,
  required by the new discovery-card RPC.
- Staging is **not empty**. Snapshot counts: 17 Auth users, 15 novels,
  6 episodes, 2 profiles, 2,741 valid read sessions and 2,749 SCOUT XP
  ledger entries. Never reset or drop Staging on the assumption it is empty.

## Why the existing Staging sync cannot safely solve this

The fixed .github/workflows/supabase-staging-sync.yml requires exactly
one pending migration; a current-main-SHA, scope and one-run-bound
**「ステージング承認」** through Issue #294; a complete precheck/postcheck/
rollback artifact set; verified dedicated target/TLS; and final full
repository/Staging history parity.

With 26 pending repo migrations and one unexpected Staging history entry,
no single pending migration can pass its exact-pending gate. Weakening the
gate or calling direct migration repair/db push would bypass reviewed safety
contracts and is forbidden.

Most affected historical migration versions are missing some or all required
safety files. Several scripts contain data-changing SQL; for example
20261003030000_backfill_pre_beta_v2_valid_reads.sql targets specific historic
sessions. Blind application to a different populated Staging data set is
not safe and must not be classified as idempotent.

## Read-only recovery readiness probe

scripts/audit-staging-migration-recovery.mjs reuses the existing validated,
read-only Supabase Management API migration-history reader. It compares
canonical versions, detects extra/missing history, inventories strict
per-version safety artifacts, and flags possible DML for manual review.
Matching or missing DML markers are NOT an executable-safety guarantee.

Run using an existing approved read-only environment with
STAGING_SUPABASE_URL and SUPABASE_ACCESS_TOKEN:

    node scripts/audit-staging-migration-recovery.mjs

The output is JSON, without credentials. Exit 0 means version parity;
exit 2 means drift, and exit 1 means invalid input or read failure.
The probe is strictly read-only. It never issues a mutation, touches
Production, claims an approval, or authorizes recovery.

## Data-preserving recovery steps to design and review

1. Refresh live read-only migration history, catalog inventory, privileges,
   dependencies and Staging row counts. Ensure the correct Staging project.
   Establish a verified protected backup via an independently authorized path
   before attempting any data-changing repair or reset.
2. Prove or disprove the possible equivalent search-card history versions
   20260930210000 and 20260930153337 by reviewing *all* actual SQL effects.
   A name/function hash match alone cannot justify migration history repair.
3. Review each of the other missing migrations in order. Document their
   target tables, prerequisites, DML/data implications, pre/postconditions,
   rollback/recovery boundaries and impact on existing Staging content.
   Historic fixed-session backfills require special, explicit review.
4. Build and independently review a protected **Staging-only** recovery
   workflow if ordinary exact-single-pending sync cannot be used.
   This must require an explicit 「ステージング承認」 bound to exact main
   SHA, approved scope and one run. No generic workflow_dispatch,
   arbitrary SQL, secret echo, direct db push or bypass of the normal
   single-version workflow. Phase changes must fail closed.
5. After successful Staging alignment, separately approve any paid Staging
   smoke. Validate relevant Auth, RLS, schema, permissions and reader UI.
6. Re-run Production dry-run and the Staging-parity gate. Only once those
   pass, use the existing Production Approval Ledger route for the sole
   pending 20261011160000, carrying forward the previously approved
   same-scope human 「本番承認」. Do not reinterpret it as Staging approval.
7. Verify the live anonymous RPC and hydrated recommended/new-arrivals/
   light-seed discovery cards before claiming completion.

## Current decision boundary

No Staging mutation or paid smoke has been approved by 「続けて」 or
「本番承認」 alone. This document neither approves nor initiates
Staging/Production DB mutations. Do not silently bypass parity.
