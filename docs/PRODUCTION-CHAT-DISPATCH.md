# NOVELIGHT chat-approved Production execution

This control treats the explicit Production approval already given in ChatGPT as the human approval for one fixed Production action. It removes both the manual GitHub Actions `Run workflow` click and the duplicate `production-approval` Environment review for that chat-approved path.

It does **not** remove the ordinary manual fallback approval. `.github/workflows/supabase-production.yml` remains protected by the `production-approval` GitHub Environment for manual `repair-history` or `deploy` runs.

## Allowed operations

Chat approval is not a generic Production executor. Each allowed operation has a dedicated workflow and hard-coded contract.

### Fixed baseline history repair

- operation: `supabase-baseline-history-repair`
- workflow: `.github/workflows/production-approved-dispatch.yml`
- trigger: a new owner-authored approval record on Production Approval Ledger issue #165
- approved ref: exact current `main` SHA
- repair version: `20260815000000`
- Supabase project: fixed Production project
- database action: `supabase migration repair --status applied 20260815000000`

This route remains baseline-only. If the baseline is already SATISFIED/APPLIED, it must not be rerun.

### Normal migration deploy

- operation: `supabase-migration-deploy`
- workflow: `.github/workflows/production-migration-approved-dispatch.yml`
- trigger: a new owner-authored approval record on Production Approval Ledger issue #165
- approved ref: exact current `main` SHA
- approved migration set: canonical sorted unique list of 14-digit versions
- excluded version: `20260815000000`
- Supabase project: fixed Production project
- database action: `supabase db push --linked --yes`, only after exact pending match and a fresh dry-run

No workflow name, ref, mode, confirmation, Supabase project, credential, SQL, or shell command is accepted from either approval comment as a free-form execution parameter.

## Approval records

### Baseline repair

```text
NOVELIGHT_PRODUCTION_DISPATCH_APPROVE {"operation":"supabase-baseline-history-repair","mainSha":"<40-hex-current-main>","challenge":"<8-uppercase-hex>","repairVersion":"20260815000000"}
```

### Normal migration deploy

```text
NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_APPROVE {"operation":"supabase-migration-deploy","mainSha":"<40-hex-current-main>","challenge":"<8-uppercase-hex>","migrations":["<14-digit-version>", "..."]}
```

The workflows accept their approval comment only when all of the following are true:

- the event is a new comment on issue #165, not a pull request;
- the comment author is repository owner `bingohooah888-ai` with `OWNER` association;
- the JSON has exactly the documented keys and exact operation contract;
- `mainSha` is exactly current `main` when validation runs;
- the one-time `challenge` has not already been used for that operation/SHA;
- migration deploy versions are canonical, unique, sorted, non-empty, and exclude `20260815000000`;
- the ledger is still within the bounded comment contract.

Each workflow re-checks `main`, then records its own `..._CLAIMED` marker immediately before entering the Production execution job. The Production job independently re-reads issue #165 and requires exactly one matching claim bound to the same workflow run ID, SHA, challenge, operation, and exact repair/migration scope.

A claimed approval is one-time. Failure does not silently reuse or retry the same approval.

## Manual fallback remains protected

`.github/workflows/supabase-production.yml` remains the fallback for `status`, `dry-run`, `repair-history`, and `deploy`.

Manual mutation runs still require:

- exact typed confirmation (`REPAIR` or `DEPLOY`);
- `PRODUCTION_APPROVAL_GATE_READY=true`;
- `production-approval` GitHub Environment human approval;
- the existing Production checks inside the workflow.

The chat-approved paths do not weaken or bypass those controls for manually started runs.

## Chat-approved baseline Production boundary

For the fixed baseline repair, `.github/workflows/production-approved-dispatch.yml` performs the Production operation directly from its owner-only `issue_comment` trigger after the ledger approval has been validated and claimed.

Before touching Supabase it must:

- re-check current `main` against the approved SHA;
- re-read issue #165 and find exactly one matching baseline claim for the same workflow run;
- check out exactly the approved commit;
- use only the fixed Production project and fixed repair version;
- use the shared `supabase-production-migration` concurrency lock.

The repair retains:

- proof that `20260815000000` is still pending;
- fresh read-only verification of the historical Production core tables;
- baseline-only `supabase migration repair --status applied`;
- post-mutation migration status;
- Production observability verification and commit status publication.

This workflow contains no generic migration deploy path.

## Chat-approved migration Production boundary

For normal migrations, `.github/workflows/production-migration-approved-dispatch.yml` performs the Production deploy directly from its owner-only `issue_comment` trigger after the exact migration approval has been validated and claimed.

Before mutation it must:

- re-check current `main` against the approved SHA before claim;
- re-read issue #165 at the Production boundary and require exactly one matching migration claim for the same workflow run;
- check out exactly the approved commit;
- reject baseline version `20260815000000`;
- use only the fixed Production project;
- use the shared `supabase-production-migration` concurrency lock;
- require Production pending migration versions to exactly equal the approved migration set;
- run `supabase db push --linked --dry-run` again immediately before mutation.

Only after all of those checks pass may it run `supabase db push --linked --yes`.

After mutation it must:

- verify Production migration status and require no pending local migration;
- run Production observability read-only verification;
- publish `production-beta-verification`;
- classify mutation and postcheck outcomes separately.

A successful workflow records `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_EXECUTED`. A failed workflow records `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_FAILED` with `mutation_result`, `postcheck_result`, and `failure_phase`.

If mutation succeeded but a later postcheck failed, Evidence Freshness applies: do not repeat `db push`. Verify current migration history first and investigate the failed postcheck separately.

## Automatic main-push plan

`.github/workflows/supabase-production-auto-deploy.yml` is intentionally read-only with respect to the database.

A push that adds `supabase/migrations/**` automatically performs:

- changed-version detection;
- exact Production pending comparison;
- `supabase db push --linked --dry-run`;
- an Actions summary containing main SHA, versions, and an explicit `mutation: none` handoff.

It does **not** use `production-approval`, and it does **not** contain `supabase db push --linked --yes`.

This avoids creating a second approval prompt before the user has approved in chat and avoids a waiting Environment run blocking the shared migration concurrency lock.

## Stale waiting-run cleanup

PR #219's first migration bridge dispatched `.github/workflows/supabase-production.yml`, which can leave a bot-started run waiting at `production-approval`.

The cleanup contract is implemented once in `scripts/cleanup-stale-production-migration-run.mjs`. It is used both by the fresh read-only preflight path and by the normal chat-approved migration deploy path.

For a fresh `NOVELIGHT_PRODUCTION_MIGRATION_PREFLIGHT <mainSha>` request, `.github/workflows/production-migration-preflight.yml` first binds the request to exact current `main` and runs the cleanup contract **outside** the shared `supabase-production-migration` lock. The cleanup job has no Supabase credentials and performs no database operation. Only after cleanup succeeds does the status/dry-run job enter the shared migration lock and access Production Supabase read-only.

The cleanup may cancel an obsolete manual fallback run only under this narrow migration-specific contract:

- any human-started active manual Supabase Production run causes a fail-closed stop;
- any unexpected active bot event causes a fail-closed stop;
- more than one active bot-started manual run causes a fail-closed stop;
- the single bot-started run must still be in GitHub Actions `waiting` state;
- the waiting run must target an older SHA, never the newly requested/approved main;
- issue #165 must contain exactly one matching prior `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_DISPATCHED` record for that old SHA and `supabase-production.yml` target;
- the prior dispatch must contain a valid one-time challenge, canonical non-baseline migration set, and bridge run id;
- cancellation must reach `cancelled` before the caller proceeds.

No unrelated Actions run may be cancelled through this cleanup. If no stale waiting run exists, cleanup is a no-op. The cleanup itself is not Production database mutation and cannot approve or execute a migration.

## Freshness and replay rules

Approvals are SHA-bound and one-time. If `main` advances after the approval comment, execution fails closed and a fresh explicit Production approval is required. If an approval was already claimed, it cannot be reused.

Evidence Freshness remains mandatory before a new approval record is written. If the same Production mutation is already proven complete, it must not be repeated.

New Production operation types must not be added as free-form inputs. Each new operation requires a separate reviewed code change that hard-codes the scope, adds regression tests, preserves Evidence Freshness, uses an appropriate Production concurrency lock, and keeps manual fallback protections intact.

## Production Authenticated Smoke chat-approved request dispatch

The Production Authenticated Smoke execution remains in `.github/workflows/production-authenticated-smoke.yml`. The chat-approved bridge only removes the manual GitHub Actions `Run workflow` click needed to create a fresh scoped approval request.

- operation: `production-authenticated-smoke`
- bridge workflow: `.github/workflows/production-auth-smoke-approved-dispatch.yml`
- trigger: a new owner-authored dispatch approval record on Production Approval Ledger issue #165
- approved ref: exact current `main` SHA
- target workflow: fixed `production-authenticated-smoke.yml`
- dispatched ref: fixed `main`
- bridge mutation: GitHub workflow dispatch and ledger records only; no Production application/database/billing mutation

The exact bridge approval record is:

```text
NOVELIGHT_PRODUCTION_AUTH_SMOKE_DISPATCH_APPROVE {"operation":"production-authenticated-smoke","mainSha":"<40-hex-current-main>","challenge":"<8-uppercase-hex>"}
```

The bridge accepts the record only when:

- the event is a new comment on issue #165, not a pull request;
- the author is repository owner `bingohooah888-ai` with `OWNER` association;
- the JSON contains exactly `operation`, `mainSha`, and `challenge`;
- `operation` is exactly `production-authenticated-smoke`;
- `mainSha` is exact current `main` before validation, before claim, and immediately before dispatch;
- the eight-character uppercase hexadecimal `challenge` has not already been claimed, dispatched, or failed for the same operation/SHA;
- the ledger remains within the bounded comment contract.

The bridge hard-codes the target workflow and `main` ref. Neither workflow name nor ref is accepted from the approval comment. The bridge has no Supabase or Stripe credentials, no `Production` environment, and cannot create smoke users or other Production application data.

The bridge records `NOVELIGHT_PRODUCTION_AUTH_SMOKE_DISPATCH_CLAIMED` before dispatch. A successful dispatch records `NOVELIGHT_PRODUCTION_AUTH_SMOKE_DISPATCHED`; a claimed failure records `NOVELIGHT_PRODUCTION_AUTH_SMOKE_DISPATCH_FAILED`. The same challenge is one-time and is not silently retried.

After the fixed request workflow is dispatched, the existing Auth Smoke workflow creates its bot-owned dedicated approval issue with its own random request challenge and expiry. The final `NOVELIGHT_PRODUCTION_AUTH_SMOKE_APPROVE` comment on that dedicated issue remains mandatory before any Production smoke write.

When the user has already explicitly approved the same Production Authenticated Smoke scope in chat, ChatGPT/Connector may post that exact final owner approval comment automatically after verifying that the request SHA is still current, the request has not expired or been consumed, and the scope has not changed. A new user approval is required if `main` advances or the Production scope changes.

The existing Auth Smoke workflow remains responsible for:

- validating the bot-owned request issue, request ID, SHA, challenge, expiry, and one-time claim;
- re-checking current `main` immediately before Production write;
- creating only ephemeral Production smoke users/data;
- running authenticated beta-critical smoke coverage;
- cleanup with `always()`;
- creating no Stripe charge;
- recording consumed/failed result and closing only its dedicated approval issue.

Issue #165 is the shared Production Approval Ledger and must never be closed by the Auth Smoke dispatch bridge.
