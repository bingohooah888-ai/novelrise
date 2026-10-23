# NOVELIGHT SPECIAL — isolated Staging acceptance runbook

Status: **prepared; NOT executed on live Supabase or Vercel**  
Workstream: PR #2442 (NOVELIGHT SPECIAL v1)  
Reference: `docs/NOVELIGHT-SPECIAL-spec-v1.md`

## Why use a fresh disposable Supabase branch

Read-only inspection on 2026-10-23 established that the existing Supabase
Staging branch (`wmlzjgvxgoyrovdhbqbg`) is marked `MIGRATIONS_FAILED`.
Its applied migrations differ from Production (`fiepaguycecrredwrcwx`):

- Staging only: `20261014052000 community_plaza_phase1`
- Production only: `20261022010000 author_activity_publication_timestamps`,
  `20261022010100 author_activity_first_episode`,
  `20261022203000 starfestival_december_schedule`.

**Do not reset, rebase, repair or overwrite this shared Staging branch** as part
of SPECIAL. The branch may contain other work and its data is not disposable.

The safest next DB-only proof is a *new temporary Supabase development branch*
that starts from Production migration history without Production user data.
Never target the Production ref for any mutation.

## Cost and human approval boundary

Supabase's organization-specific branch estimate, fetched read-only on
2026-10-23: **US $0.01344 per hour**. This is an hourly estimate, not a guaranteed
total bill; other usage/rounding can apply.

The user's previous `ステージング承認` authorized testing the existing
Staging workflow. Creation of an **additional billable branch** is a materially
new cost/scope decision. Require explicit consent describing the new branch,
charge and planned immediate deletion. After consent, bind the single execution
to the fresh main SHA, exact PR candidate SHA, scope, branch name and the
existing owner-authored approval ledger. Do not bypass runtime cost/permission
confirmation. No action is pre-authorized merely by the presence of this file.

## Before any branch creation (read-only)

1. Fetch current `main` SHA and PR #2442 exact head SHA.
2. Verify the PR is Draft; compare its changed paths with main, test status,
   security/CodeQL/Safari checks and dependency lockfile.
3. Verify Production and Staging project refs remain distinct and that no
   SPECIAL migration appears as applied in Production.
4. Verify the Supabase organization/project charge and the created branch's
   deletion permissions. If deletion is unavailable, **do not create**.
5. Verify the owner-authored one-time approval path for this exact workstream.
   The current migration-sync workflow for Issue #294 accepts only migrations
   already merged into `main`; it is not a safe path for this PR's migration.
6. Prepare a maximum-cost/runtime budget and stop/cleanup plan. No deployment
   or Supabase writes without the specific approval and the provider's consent.

## Execution after the new cost/scope approval

1. Create exactly one explicitly named temporary Supabase branch. Record its
   returned ID and project ref *from the provider*, not by guessing.
2. Verify it is a new nondefault branch and its project ref differs from
   Production and the long-lived Staging branch. Confirm it was created
   without copying Production data, and that SPECIAL tables do not yet exist.
3. Supabase initializes settings, schema migrations, and Edge Functions in
   separate phases. **Do not equate FUNCTIONs_DEPLOYED, ACTIVE_HEALTHY or an
   accessible SQL endpoint with complete migration history.** Compare the
   branch's exact migration-version set with the freshly read Production
   baseline, then poll status and versions only (read-only). A partial history
   such as 28/190 can be *in progress*, not necessarily a failure.
   Use `scripts/special-branch-readiness.mjs` to classify snapshots:
   `wait` until exact parity and provider readiness, `ready` only with
   complete version equality, or `abort` for provider-reported failure,
   unexpected versions, identity mismatch, or a 5-minute initialization
   deadline. A timeout is an **unconfirmed startup problem**; review provider
   logs before calling any migration defective. Never re-create automatically.
4. Apply **only** the reviewed
   `supabase/migrations/20261022204944_novelight_special.sql` to the new
   project ref. Never replay unrelated migrations to the existing Staging.
5. Verify the new schema/RLS, `special-evidence` private Storage bucket,
   triggers, database grants and migration history.
6. Run `tests/sql/special-staging-acceptance.sql` (via a trusted executor;
   transaction rolls test-data changes back) and verify that no test rows
   remain. Confirm any unexpected failure before rerunning.
7. Test ADMIN allowlist, published/withdrawn states, signed evidence upload
   and deletion *only if a separate isolated identity, app credentials and
   short-lived authenticated runner exist*. If unavailable, record as
   **not tested**; never use Production authorization credentials as fallback.
8. Capture redacted results (only branch reference/commit/test outcomes, no
   tokens, email addresses, contracts or full access logs).
9. Immediately delete only the newly returned branch ID; check the branch list
   afterwards. Report any failure to delete as a cost/cleanup incident.
10. Close the one-time operation and return to Default-Deny. Any Vercel Preview
   is a separate named scope and must be tied to the same isolated ref, not to
   Production or the shared Staging environment.

## 2026-10-23 first disposable-branch finding (read-only diagnosis)

The approved disposable branch was created and subsequently deleted with
successful provider deletion verification. A read-only snapshot taken shortly
after creation showed **28 migration rows versus 190 on Production**.
No migration or acceptance SQL was applied on that branch.

**This snapshot does not prove migration failure**. Supabase's documented
creation workflow runs database migrations asynchronously alongside settings
and Edge Functions, with the branch becoming ready only after all complete.
The earlier 28/190 stop was safe but potentially premature. The specific cause
remains unconfirmed because the transient branch was deleted before detailed
migration-run logs were captured.

The next authorised attempt, if any, must wait for provider completion or
a bounded 5-minute stop using `scripts/special-branch-readiness.mjs`.
Where available, record redacted branch workflow logs, particularly the
`migrate` step's `EXITED/DEAD` result, before cleanup. The 29th migration is
`20260906204000_retire_author_gallery_feature.sql`; do not alter it based on
sequence position alone. Do not touch Production migration history.

Official reference:
https://supabase.com/blog/how-a-new-branch-gets-its-config-migrations-and-functions

## Abort / safety conditions

Hard-fail before mutation on: target project ambiguity, non-owner approval,
main or PR drift, unauthorized scope, missing branch deletion rights, missing
provider cost consent, missing safe service role/Storage isolation, or any
environment value pointing at Production.

**Never call `reset_branch`, `rebase_branch` or `merge_branch` for the existing
Staging branch as part of SPECIAL. Never merge PR #2442, apply a Production
migration or deploy Production without separate explicit `本番承認`.**

## Existing executable proof

- `tests/sql/special-staging-acceptance.sql` — rollback-only constraints
  acceptance; if run in Supabase, must use the **confirmed new project ref**.
- `tests/special-preview-isolation.test.mjs` — Preview cannot connect to
  Production in SPECIAL API/Admin/sitemap.
- Standard CI/CodeQL/Safari — static and disposable regression proof.

Status as of the initial authorised attempt: **one temporary branch was
created and verifiably deleted**. No SPECIAL migration, Preview deployment,
shared Staging write, or Production write was performed. A second branch would
require new explicit cost/scope approval.
