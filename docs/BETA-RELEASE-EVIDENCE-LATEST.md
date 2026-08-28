# NOVELIGHT β Release Evidence — Latest Reconciled State

**Reconciled: 2026-08-28 JST**

This file is the rolling current-state index required by `docs/EVIDENCE-FRESHNESS-GATE.md`.
Dated `BETA-RELEASE-EVIDENCE-*.md` files remain historical snapshots. A newer same-scope workflow, approval-ledger entry, commit comparison, or read-only live observation supersedes older descriptive status when no later material change invalidates the proof.

## Current main

- `97a67fc423c6be79280c861a2a3d5659877b351f`
- Commit: `Automate Production backup freshness gate (#197)`

## Current release decision

**Controlled public-beta GO: NOT YET RECORDED.**

All non-deferred hard gates in `docs/BETA-RELEASE-CHECKLIST.md` have now been reconciled to current or still-valid evidence. The remaining release action is the separate explicit controlled public-beta GO decision/record.

Qualified Japanese counsel review is **DEFERRED BY OWNER UNTIL AFTER CONTROLLED BETA LAUNCH / STILL PENDING**. The owner residual-risk decision was recorded on 2026-08-28 in `docs/legal-beta-review.md`. This is a release-timing/risk decision only and is not a finding that the current legal surfaces or operations are legally sufficient.

## Git / CI — PASS / CURRENT

Latest main evidence:

- `NOVELIGHT CI` run #864, run `33172222449`, head `97a67fc423c6be79280c861a2a3d5659877b351f`: `success`.
- Required aggregate `check`: `success`.
- Node tests: `success`.
- Static quality: `success`.
- GitHub Actions semantic lint: `success`.
- `CodeQL` run #801, run `33172222430`, same head: `success`.

Desktop + mobile Playwright coverage was added by PR #195 and passed its applicable CI gate. Later commits through current main do not change public product/application behavior; they are control-plane, documentation, test, and operations changes, so the browser evidence remains current for its scope.

No current evidence indicates user-facing `NovelRise` / `NOVELRISE` / `novelrise` branding remains in root HTML. The current Production static-route proof also checks that contract.

## Supabase Production — PASS / HISTORICAL BUT STILL VALID

`docs/BETA-RELEASE-EVIDENCE-2026-08-23.md` records the observed Production migration sequence, postchecks, signup redirect, recovery redirect, password-reset E2E, signup confirmation, and profile persistence.

No later change through current main modifies the Production schema/data target, authentication product flow, or public application behavior in a way that invalidates those proofs. The migration parser/control-plane changes after the product baseline do not themselves require repeating the already completed Production mutations.

## Backup / restore — PASS / CURRENT

Historical hard-gate evidence from `docs/BETA-RELEASE-EVIDENCE-2026-08-23.md` remains valid:

- Production Supabase upgraded to Pro;
- automatic scheduled daily backups enabled;
- 7-day scheduled-backup retention observed;
- a pre-release recovery point existed;
- `docs/BACKUP-RESTORE-RUNBOOK.md` reviewed;
- non-production restore rehearsal succeeded against a disposable project;
- restored novels, episodes, profiles, and auth users were observed;
- disposable restore project was deleted;
- Production remained healthy;
- PITR remains intentionally disabled for the beta recovery posture.

Fresh current evidence:

- Workflow: `NOVELIGHT Production Backup Freshness`
- Run: `33172222421` (#1)
- Head: `97a67fc423c6be79280c861a2a3d5659877b351f`
- Conclusion: `success`
- Latest completed Production backup observed: `2026-08-27T21:05:06.506Z`
- Age at observation: `15.63h`
- Freshness limit: `36h`
- Completed backups returned: `7`

The freshness workflow is read-only. It does not call restore or other write endpoints.

## Content / moderation — PASS / HISTORICAL BUT STILL VALID

`docs/BETA-RELEASE-EVIDENCE-2026-08-23.md` records automated evidence for:

- AI-use classification on publication;
- mature-content warnings and direct-episode warning gate;
- the controlled-beta sexually explicit/pornographic prohibition;
- novel and episode report submission into `content_reports`;
- raw report rows being unreadable by anon/authenticated clients;
- the controlled-beta operator routine in `docs/BETA-OPERATIONS-RUNBOOK.md`.

No later material product change invalidates this scope.

## Discovery / LIGHT ANALYTICS — PASS / HISTORICAL BUT STILL VALID

`docs/BETA-RELEASE-EVIDENCE-2026-08-23.md` records automated database/source evidence for:

- Free initial exposure;
- Free / Standard / Premium general-feed inclusion;
- Standard `home_plan_extra` / plan-extra exposure;
- separate Premium dedicated exposure;
- recommended/new/PV/favorite search impression recording;
- impression -> detail CTR;
- detail -> episode 1 rate;
- episode 1 -> episode 2 rate;
- actual recorded plan-added impression counts.

Authenticated Staging product evidence later supplemented this with the end-to-end LIGHT ANALYTICS funnel. No later material product change invalidates this scope.

## Beta-start data — PASS / CURRENT

The 2026-08-23 evidence records automated coverage for:

- X `utm_source=x` acquisition touch;
- first-touch acquisition claim on registration/login;
- daily revisit/lifecycle activity without raw visitor-token storage;
- direct/X detail and episode events independent of internal discovery attribution;
- concurrency-safe Founding Author #001–#100 assignment;
- Stripe webhook idempotent subscription event history.

Later authenticated/billing evidence does not invalidate these contracts.

## Authenticated Staging product / final smoke — PASS / CURRENT

Current accepted combined lifecycle proof:

- Workflow: `NOVELIGHT Staging Smoke`
- Run: `33135672826` (#98)
- Reviewed implementation baseline: `0ba72358b5213ff409aed2fca24e3af7bf1ff025`
- Conclusion: `success`

The run covers the controlled Staging product/auth/billing lifecycle and cleanup, including authentication, published content, favorite, LIGHT SEED, SCOUT RECORD, LIGHT ANALYTICS, isolated Stripe test Checkout, entitlement reconciliation, Billing Portal, cancellation, and cleanup.

A compare from `0ba72358b5213ff409aed2fca24e3af7bf1ff025` to current main `97a67fc423c6be79280c861a2a3d5659877b351f` shows later changes only in workflows, governance/legal documentation, operations scripts, and tests. No public HTML/application/API product behavior file changed. Therefore this proof remains `current` for the final-smoke product/auth/billing scope and must not be repeated solely because main advanced.

## Production authenticated path — PASS / CURRENT

Existing successful Production Authenticated Smoke evidence remains accepted as `current` under `docs/EVIDENCE-FRESHNESS-GATE.md`. Later main changes do not materially alter the proved authentication/product boundary. Later unrelated/skipped `issue_comment` workflow invocations are not failures and do not supersede the existing successful proof.

## Production external Stripe webhook delivery — PASS / CURRENT

Decisive proof:

- Workflow: `NOVELIGHT Chat-Mediated Production Approval`
- Run: `33065836764`
- Proof SHA: `944c2232a577ebeae32798c29a508b8540a26807`
- Workflow conclusion: `success`
- Completion contract: no-charge external webhook proof completed and final billing audit issue count `0`
- Approval ledger: issue `#165`, request consumed with success

Scoped proof:

`Stripe Live event creation without artificial paid charge -> Production Vercel webhook -> Production Supabase entitlement/cancellation reflection -> final billing audit`.

No later material change to `api/stripe-webhook.js`, the Production webhook endpoint/signing-secret state, Production Supabase target, or the decisive proof implementation has been identified. The proof remains `current`; duplicate execution of the same Production mutation is prohibited.

## Production public/legal surfaces — PASS / CURRENT

Final-candidate read-only observation is satisfied by the current Production static-route evidence and freshness analysis:

- `NOVELIGHT Production Readiness Smoke` #43, run `33145249649`: `success`.
- The scheduled full-route mode checks Production static routes, read-only reader behavior, Production observability, repository-to-Production root HTML consistency, and absence of the old `NovelRise` branding contract.
- The intended public legal/contact routes and navigation include terms, privacy, content guidelines, billing policy, commerce disclosure, and contact; signup/pricing expose the relevant consent and billing/legal links.
- From the reviewed implementation baseline through current main, no public HTML file changed, so the successful Production surface proof remains current.

This is an engineering/read-only reachability observation, not legal advice.

## Legal / brand status — RECORDED WITH DEFERRED COUNSEL REVIEW

`docs/legal-beta-review.md` now records:

- Qualified Japanese counsel review: **DEFERRED BY OWNER UNTIL AFTER CONTROLLED BETA LAUNCH / STILL PENDING**.
- Explicit owner residual-risk decision: **RECORDED 2026-08-28**.
- The decision does not establish legal sufficiency or waive mandatory law, regulator, payment-provider, hosting/platform, or other applicable requirements.
- Public-beta legal GO is not independently inferred from this status; the explicit final release decision remains separate.

The checklist item requiring the final Japanese legal-review **status** and any accepted residual risk to be recorded is therefore satisfied without representing counsel review as completed.

## Checklist reconciliation

`docs/BETA-RELEASE-CHECKLIST.md` is reconciled in parallel with this rolling index.

All non-deferred hard checklist scopes have decisive current or still-valid evidence. An `[x]` in that checklist means the scope is supported by such evidence under the Evidence Freshness Gate; it does not imply every external operation was re-run on current main.

No newly unknown non-deferred hard gate was identified in the final reconciliation.

## Remaining release action

The next and only remaining release-record step is:

1. make and record the explicit **controlled public-beta GO / NO-GO decision** against the then-current main and this reconciled evidence.

Qualified counsel review remains an explicit post-launch deferred item and must not be silently converted to `completed`.

Before the GO record, re-fetch current main and apply the Evidence Freshness Gate once more. If a material product, Production, billing, auth, legal/public-surface, backup, or security change lands after this reconciliation, only the affected scope must be refreshed.

Do not repeat already-current Production mutations merely for documentary freshness.