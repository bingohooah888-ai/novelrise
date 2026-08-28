# NOVELIGHT β Release Evidence — Latest Reconciled State

**Reconciled: 2026-08-28 JST**

This file is the rolling current-state index required by `docs/EVIDENCE-FRESHNESS-GATE.md`. Dated `BETA-RELEASE-EVIDENCE-*.md` files remain historical snapshots. Newer same-scope workflow, approval-ledger, compare, or read-only live evidence supersedes older descriptive status when no later material change invalidates the proof.

## Release decision

**Controlled public-beta GO: RECORDED 2026-08-28.**

Decision record: `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Decision baseline main: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1` (`Reconcile beta release evidence closure (#198)`).

All non-deferred hard gates in `docs/BETA-RELEASE-CHECKLIST.md` were reconciled to current or still-valid decisive evidence immediately before the GO decision. Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING** with owner residual risk recorded in `docs/legal-beta-review.md`. This GO is an operational release decision, not a finding of legal sufficiency.

## Git / CI — PASS / CURRENT

Latest decision-baseline evidence:

- `NOVELIGHT CI` run #866, run `33173431807`, head `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1`: `success`.
- Required aggregate `check`: `success`.
- Node tests: `success`.
- Static quality: `success`.
- Vercel commit status: `success`.

The preceding PR #198 CI and CodeQL also succeeded. A compare from prior evidence baseline `97a67fc423c6be79280c861a2a3d5659877b351f` to the GO decision baseline modifies only `docs/BETA-RELEASE-CHECKLIST.md` and `docs/BETA-RELEASE-EVIDENCE-LATEST.md`. No public product/application, auth, billing, database/RLS, security-boundary, or legal/public HTML implementation changed.

Desktop + mobile Playwright evidence remains current for its scope because no later material product behavior change invalidates it.

## Supabase Production — PASS / HISTORICAL BUT STILL VALID

`docs/BETA-RELEASE-EVIDENCE-2026-08-23.md` records the Production migration sequence, status/dry-run checks, postchecks, signup/recovery redirect configuration, password-reset E2E, signup confirmation, and profile persistence.

No later material schema/auth-product change invalidates those proofs. Parser/control-plane work does not require repeating completed Production mutations.

## Backup / restore — PASS / CURRENT

Historical hard-gate evidence remains valid:

- Production Supabase Pro scheduled backups enabled;
- 7-day scheduled-backup retention observed;
- pre-release recovery point existed;
- `docs/BACKUP-RESTORE-RUNBOOK.md` reviewed;
- non-production restore rehearsal succeeded against a disposable project;
- restored novels, episodes, profiles, and auth users were observed;
- disposable restore project deleted and Production remained healthy;
- PITR intentionally remains disabled for the beta recovery posture.

Fresh read-only evidence:

- Workflow: `NOVELIGHT Production Backup Freshness`
- Run: `33172222421` (#1)
- Head: `97a67fc423c6be79280c861a2a3d5659877b351f`
- Conclusion: `success`
- Latest completed Production backup observed: `2026-08-27T21:05:06.506Z`
- Age at observation: `15.63h`
- Freshness limit: `36h`
- Completed backups returned: `7`

The later GO-decision baseline changes only release documentation and does not affect backup state or the backup control path, so this evidence remains current for the release decision.

## Content / moderation — PASS / HISTORICAL BUT STILL VALID

Current/still-valid evidence covers:

- AI-use classification on publication;
- mature-content warnings and direct-episode warning gate;
- controlled-beta sexually explicit/pornographic prohibition;
- novel/episode report submission into `content_reports`;
- raw report rows unreadable by ordinary anon/authenticated clients;
- controlled-beta operator routine in `docs/BETA-OPERATIONS-RUNBOOK.md`.

No later material product change invalidates this scope.

## Discovery / LIGHT ANALYTICS — PASS / HISTORICAL BUT STILL VALID

Current/still-valid evidence covers:

- Free initial exposure;
- Free / Standard / Premium general-feed inclusion;
- Standard `home_plan_extra` exposure;
- separate Premium dedicated exposure;
- search impression recording across recommended/new/PV/favorite sorts;
- impression -> detail CTR;
- detail -> episode 1 rate;
- episode 1 -> episode 2 rate;
- actual recorded plan-added impression counts.

Authenticated Staging product evidence also covers the end-to-end LIGHT ANALYTICS funnel. No later material product change invalidates this scope.

## Beta-start data — PASS / CURRENT

Current/still-valid evidence covers:

- X `utm_source=x` acquisition touch;
- first-touch acquisition claim on registration/login;
- daily revisit/lifecycle activity without raw visitor-token storage;
- direct/X detail and episode events independent of internal discovery attribution;
- concurrency-safe Founding Author #001–#100 assignment;
- Stripe webhook idempotent subscription event history.

## Authenticated Staging product / final smoke — PASS / CURRENT

Accepted combined lifecycle proof:

- Workflow: `NOVELIGHT Staging Smoke`
- Run: `33135672826` (#98)
- Reviewed implementation baseline: `0ba72358b5213ff409aed2fca24e3af7bf1ff025`
- Conclusion: `success`

The run covers authentication, published content, favorite, LIGHT SEED, SCOUT RECORD, LIGHT ANALYTICS, isolated Stripe test Checkout, entitlement reconciliation, Billing Portal, cancellation, and cleanup.

Later changes through the GO decision baseline are control-plane, governance/documentation, operations scripts, or tests and do not materially change the public application behavior proved by this run. Therefore the proof remains `current` and must not be repeated solely because main advanced.

## Production authenticated path — PASS / CURRENT

Existing successful Production Authenticated Smoke evidence remains accepted as `current` under `docs/EVIDENCE-FRESHNESS-GATE.md`. Later unrelated/skipped `issue_comment` invocations do not supersede the successful proof.

## Production external Stripe webhook delivery — PASS / CURRENT

Decisive proof:

- Workflow: `NOVELIGHT Chat-Mediated Production Approval`
- Run: `33065836764`
- Proof SHA: `944c2232a577ebeae32798c29a508b8540a26807`
- Conclusion: `success`
- Approval ledger: issue `#165`, request consumed successfully
- Completion contract: no-charge external webhook proof plus zero final billing-audit issues

Scoped proof:

`Stripe Live event creation without artificial paid charge -> Production Vercel webhook -> Production Supabase entitlement/cancellation reflection -> final billing audit`.

No later material change to the decisive webhook-handler boundary, endpoint/signing-secret state, Production Supabase target, or proof implementation has been identified. The proof remains `current`; duplicate execution of the same Production mutation is prohibited.

## Production public/legal surfaces — PASS / CURRENT

Final-candidate read-only observation remains current:

- `NOVELIGHT Production Readiness Smoke` #43, run `33145249649`: `success`.
- Full-route mode checks Production static routes, read-only reader behavior, Production observability, repository-to-Production root HTML consistency, and absence of old `NovelRise` branding.
- Intended terms, privacy, content-guidelines, billing-policy, commerce-disclosure, and contact routes and relevant signup/pricing links are covered by the reviewed public surface.
- No later public HTML change invalidates the proof.

This is an engineering/read-only reachability observation, not legal advice.

## Legal / brand status — GO RECORDED WITH DEFERRED COUNSEL REVIEW

`docs/legal-beta-review.md` records:

- Qualified Japanese counsel review: **DEFERRED BY OWNER / STILL PENDING**.
- Explicit owner residual-risk decision: **RECORDED 2026-08-28**.
- Controlled public-beta GO: **RECORDED 2026-08-28**.
- The GO and residual-risk decision do not establish legal sufficiency or waive mandatory law, regulator, payment-provider, hosting/platform, or other applicable requirements.

## Checklist reconciliation

`docs/BETA-RELEASE-CHECKLIST.md` is reconciled in parallel with this rolling index.

All non-deferred hard checklist scopes have decisive current or still-valid evidence. An `[x]` means the scope is supported under the Evidence Freshness Gate; it does not imply every external operation was re-run on the decision baseline.

No newly unknown non-deferred hard gate was identified before GO.

## Current release state

**Controlled public-beta: GO — RECORDED 2026-08-28.**

Qualified counsel review remains an explicit post-launch deferred item and must not be silently converted to `completed`.

No additional Production mutation is authorized by this documentation-only GO record. Existing Production/Secret/Stripe live/Supabase Production/Vercel Production approval boundaries remain in force.

If a material product, Production, billing, auth, database/RLS, security, legal/public-surface, backup, or release-control change lands before the actual beta opening or materially changes the launch state, refresh only the affected scope under `docs/EVIDENCE-FRESHNESS-GATE.md`. Do not repeat current Production mutations merely for documentary freshness.