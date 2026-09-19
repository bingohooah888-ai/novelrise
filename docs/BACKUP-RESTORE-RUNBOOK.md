# NOVELIGHT production backup and restore runbook

Last updated: 2026-09-19

## Purpose

This runbook covers **real production data recovery**. Migration rollback is not a database backup and is not a substitute for restoring lost/corrupted rows.

NOVELIGHT treats auth/account data, novels, episodes, favorites, LIGHT SEED/valid-read/Rank history, exposure/funnel data, acquisition/retention ledgers, moderation reports, billing state, reader progress/bookshelf state, Block/Mute state, revision history, series/chapter structure, character data, author notes/polls, reader curation lists, collaboration state, and private author story-planning notes as production-critical data.

## Public-beta GO gate

Public beta is **NO-GO** until the operator has recorded all of the following in the release checklist:

1. The production Supabase project's automatic backup / point-in-time recovery capability has been checked in the Supabase dashboard for the actual paid/project plan in use.
2. The available recovery window and retention period have been written down.
3. A recent recovery point exists from before the release/deployment window.
4. The operator knows how to initiate a restore or has verified the provider's documented restore process.
5. A restore rehearsal has been completed on a non-production target or an equivalent disposable environment without overwriting production.
6. The result and date of that rehearsal have been recorded.

Do not assume a capability exists because it existed on another Supabase plan. Verify the production project itself.

## Before any high-risk production change

High-risk changes include schema migrations touching critical tables, RLS changes, destructive cleanup, bulk imports, data backfills, auth changes, billing entitlement changes, and large automated maintenance jobs.

Before execution:

- Confirm the exact production project/ref.
- Confirm the latest provider backup/recovery point is recent enough.
- Record the recovery-point timestamp and recovery-window/retention information.
- Run the repository migration status/dry-run workflow.
- Confirm only the expected migrations are pending.
- Review the matching rollback file where one exists.
- Determine whether rollback is schema-only or data-destructive.
- If a change can destroy data, prefer a fresh logical/export backup to an approved private storage destination in addition to provider recovery. Do **not** commit database dumps to GitHub and do **not** attach unencrypted production dumps to GitHub Actions artifacts.
- Define the success checks and the abort threshold before deploying.

## Automated restored-target validation

After a provider restore or PITR completes on a **non-production/disposable target**, run the repository's read-only structural validation before any application traffic is pointed at that target:

```bash
psql "$RESTORED_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f supabase/checks/restore_validation.sql
```

The validation fails closed when a current production-critical table/function is missing, when selected private tables have lost RLS, or when core ownership/integrity invariants such as orphan profiles, orphan episodes, or duplicate favorites are broken. It also verifies the active exposure and valid-read rule rows exist.

A PASS from this SQL is **necessary but not sufficient**. Continue with the human/browser checks below, especially Auth, private-data isolation, reader/author writes, and Stripe reconciliation. Never point `RESTORED_DATABASE_URL` at public-beta Production for a rehearsal.

The same SQL runs at the end of `scripts/run-migration-replay.sh`, so new migrations that accidentally make a fresh NOVELIGHT schema unrestorable should fail CI before merge.

## Incident classification

### A. Application regression, data intact

Examples: bad HTML/JS deployment, broken API handler, incorrect feature flag.

Recovery:

1. Stop further writes if the bug can corrupt data.
2. Revert/redeploy the last known-good application commit.
3. Verify auth, read/write, billing and core reader routes.
4. Do not restore the database if the data is intact.

### B. Schema/RLS regression, data intact

Examples: incorrect RLS, function/constraint migration, missing permission.

Recovery:

1. Stop affected writes if needed.
2. Inspect the migration and its rollback script.
3. Run rollback only after checking the data impact noted in the rollback file.
4. Run post-rollback RLS/integrity checks.
5. If rollback would discard post-migration data, use provider PITR/restore instead of blindly rolling back.

### C. Row deletion/corruption or unrecoverable bad backfill

Examples: novels/episodes deleted, fields overwritten, ledger rows corrupted.

Recovery:

1. Immediately stop the write path that is causing damage.
2. Record the estimated first bad-write time and last known-good time in UTC and JST.
3. Preserve current evidence/logs before restore.
4. Select a recovery point immediately before the first bad write.
5. Prefer recovery into a non-production/restored project first when the provider workflow allows it.
6. Compare the restored copy with the current production database and determine whether full restore or selective row recovery is safer.
7. If full restore is required, communicate the accepted data-loss window before executing it.
8. After restore, reconcile billing/subscription state with Stripe before re-enabling paid entitlement writes.

## Restore validation checklist

A restore is not complete when PostgreSQL merely starts. Verify:

### Authentication and profiles
- Existing test user can sign in.
- Password recovery redirect/config is intact.
- `profiles` ownership and current plan fields are readable only as intended.

### Author data
- Expected sample novels and episodes exist.
- Draft/published state is correct.
- AI/content classification columns are present.
- No orphan episodes exist.
- Series/chapter ordering and scheduled-publication metadata still resolve.
- Episode revision history is present for works that had revisions.
- Character registry and appearance state remain owner-bound.
- Author notes, polls, collaboration state, and private story-planning notes are present where expected.
- Collaboration does not change the single canonical work owner.
- Private story-planning notes remain invisible to collaborators and readers.
- Owner INSERT/UPDATE/DELETE RLS still works and cross-user writes fail.

### Reader state
- Favorites are intact and unique per user/work; author self-favorites do not contribute to public aggregates.
- LIGHT SEED history exists and remains append-only from the client perspective.
- Valid-read history/rules exist and the server-authoritative qualification RPC executes.
- SCOUT RECORD can read only the signed-in reader's seed history.
- Reading progress and bookshelf state remain private to the signed-in reader.
- Block/Mute state survives restore and still suppresses the intended direct interactions/discovery.
- Reader curation lists preserve private/shared boundaries and do not expose private list contents.

### Discovery, Rank and analytics
- `novel_exposure_rules` and `valid_read_rules` contain the expected active beta rows.
- Exposure/funnel tables exist and are not directly client-readable.
- v2 discovery, neutral search, ranking and analytics RPCs execute.
- Public ranking/favorite aggregates still apply the current fairness hardening.
- Acquisition, activity-day and reader-journey ledgers exist and remain private.
- Pre-open/launch-clock behavior remains pinned to the public beta launch boundary where specified.

### Moderation
- `content_reports` exists and raw reports are not client-readable.
- A controlled non-production report can be submitted through the RPC.

### Billing
- `profiles.plan`, Stripe customer/subscription identifiers and statuses are internally consistent.
- `subscription_event_log` exists.
- A Stripe reconciliation/sync is performed for any interval affected by restore before treating entitlements as authoritative.

## Non-production restore rehearsal

Never use public-beta production as the target of a rehearsal.

A rehearsal should:

1. Use a disposable/non-production restore target.
2. Restore a real or safely representative backup according to the provider procedure.
3. Run `supabase/checks/restore_validation.sql` against the restored target and retain only the PASS/FAIL evidence, not production row dumps.
4. Run the browser/manual validation checklist above with controlled test accounts.
5. Record start/end, recovery-point timestamp, automated validation result, browser/manual result, and corrective actions.
6. Delete or secure the rehearsal environment when no longer needed.

Production personal data must not be copied to uncontrolled developer machines. Follow the same access controls and retention principles as production.

## Recovery record template

- Incident/change ID:
- Date/time (JST):
- Operator:
- Production project ref:
- First suspected bad write:
- Last known-good time:
- Backup/PITR capability verified:
- Recovery window/retention:
- Selected recovery point:
- Restore target:
- Expected data-loss window:
- Validation result:
- Stripe reconciliation result:
- Service reopened at:
- Follow-up actions:

## Ownership

Until a dedicated operations team exists, the service owner is responsible for confirming that the production project's real backup capability matches this runbook. Repository rollback files protect schema changes; the provider backup/recovery system protects production data.
