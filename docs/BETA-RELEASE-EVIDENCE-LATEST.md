# NOVELIGHT β Release Evidence — Latest Reconciled State

**Reconciled: 2026-08-30 JST**

This file is the rolling current-state index required by `docs/EVIDENCE-FRESHNESS-GATE.md`. Dated `BETA-RELEASE-EVIDENCE-*.md` files remain historical snapshots. Newer same-scope workflow, approval-ledger, compare, or read-only live evidence supersedes older descriptive status when no later material change invalidates the proof.

## Release decision

**Controlled public-beta GO: RECORDED 2026-08-28; CURRENT LAUNCH POSTURE RECONCILED 2026-08-30.**

Decision record: `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Historical decision baseline main: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1` (`Reconcile beta release evidence closure (#198)`).

Current audited behavioral evidence baseline: `dbf0c5418262c8cec059c8b48cac3158a5e962ac` (`Harden auth forms against async rejection (#241)`).

The GO decision record remains historical and is not rewritten. After that decision baseline, material public-product/auth/release-control changes landed, so the older GO-era proof was not assumed to remain current. The affected scopes were re-evaluated under `docs/EVIDENCE-FRESHNESS-GATE.md` and are supported by newer decisive evidence on or applicable to the current audited main.

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING** with owner residual risk recorded in `docs/legal-beta-review.md`. This GO is an operational release decision, not a finding of legal sufficiency.

## Git / CI — PASS / CURRENT

Current audited-main evidence:

- `NOVELIGHT CI` run #1048, run `33291158047`, head `dbf0c5418262c8cec059c8b48cac3158a5e962ac`: `success`.
- Required aggregate `check`: `success`.
- Node tests: `success`.
- Static quality: `success`.
- Desktop and mobile browser regression gates: `success` for the relevant current-main jobs.
- `CodeQL` run #980, run `33291157993`, head `dbf0c5418262c8cec059c8b48cac3158a5e962ac`: `success`.
- Vercel commit status for `dbf0c5418262c8cec059c8b48cac3158a5e962ac`: `success` (`Deployment has completed`).
- `NOVELIGHT Production Readiness Smoke` run #54, run `33291158004`, head `dbf0c5418262c8cec059c8b48cac3158a5e962ac`: `success`.

The compare from the historical GO decision baseline to the current audited main includes material product/auth/control changes. Therefore the old statement that later changes were documentation-only is no longer used as the freshness basis. Exact latest-main CI, CodeQL, Vercel, Production Readiness, and Production Authenticated Smoke evidence refreshes the affected current scopes without duplicating already-current Production mutations.

## Supabase Production — PASS / HISTORICAL BUT STILL VALID

`docs/BETA-RELEASE-EVIDENCE-2026-08-23.md` records the Production migration sequence, status/dry-run checks, postchecks, signup/recovery redirect configuration, password-reset E2E, signup confirmation, and profile persistence.

No later Production Supabase schema/RLS/migration/auth-configuration change has been identified that invalidates those completed Production proofs. Later auth UI/async-handling changes are covered by current-main CI and the current Production Authenticated Smoke rather than by repeating completed Supabase Production mutations.

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
- Run: `33274407623` (#3)
- Head: `b3f43d2610ccc043354bfb819cca306ea671890a`
- Conclusion: `success`
- Latest completed Production backup observed: `2026-08-28T21:03:40.759Z`
- Age at workflow observation: `23.74h`
- Freshness limit: `36h`
- Completed backups returned: `7`

The compare from that workflow head through the current audited main does not modify the backup workflow, backup-freshness script, or Production backup control path. The observed recovery point also remains inside the 36-hour hard-gate window at this reconciliation. Therefore this read-only proof remains current without a manual rerun.

## Content / moderation — PASS / CURRENT VIA COMBINED EVIDENCE

Still-valid behavioral evidence covers:

- AI-use classification on publication;
- mature-content warnings and direct-episode warning gate;
- controlled-beta sexually explicit/pornographic prohibition;
- novel/episode report submission into `content_reports`;
- raw report rows unreadable by ordinary anon/authenticated clients;
- controlled-beta operator routine in `docs/BETA-OPERATIONS-RUNBOOK.md`.

Later product hardening did not identify a material change to those moderation rules/data boundaries, and current-main CI/CodeQL plus Production Readiness/Auth smoke provide current regression reinforcement. No repeat Production mutation is required for this scope.

## Discovery / LIGHT ANALYTICS — PASS / CURRENT VIA COMBINED EVIDENCE

Still-valid evidence covers:

- Free initial exposure;
- Free / Standard / Premium general-feed inclusion;
- Standard `home_plan_extra` exposure;
- separate Premium dedicated exposure;
- search impression recording across recommended/new/PV/favorite sorts;
- impression -> detail CTR;
- detail -> episode 1 rate;
- episode 1 -> episode 2 rate;
- actual recorded plan-added impression counts.

The historical authenticated Staging lifecycle proof remains useful for the end-to-end LIGHT ANALYTICS funnel. Later navigation/favorites/auth hardening is covered by current-main CI and the current Production Authenticated Smoke. No later material discovery-selection or analytics-pipeline change requiring a new Production mutation was identified.

## Beta-start data — PASS / CURRENT VIA COMBINED EVIDENCE

Current/still-valid evidence covers:

- X `utm_source=x` acquisition touch;
- first-touch acquisition claim on registration/login;
- daily revisit/lifecycle activity without raw visitor-token storage;
- direct/X detail and episode events independent of internal discovery attribution;
- concurrency-safe Founding Author #001–#100 assignment;
- Stripe webhook idempotent subscription event history.

Current-main CI/CodeQL and Production smoke evidence reinforce the affected application paths; no later material persistence/control-path invalidation was identified for the remaining beta-start data contracts.

## Authenticated Staging lifecycle proof — PASS / HISTORICAL, STILL VALID WHERE UNAFFECTED

Accepted lifecycle proof:

- Workflow: `NOVELIGHT Staging Smoke`
- Run: `33135672826` (#98)
- Reviewed implementation baseline: `0ba72358b5213ff409aed2fca24e3af7bf1ff025`
- Conclusion: `success`

The run covers authentication, published content, favorite, LIGHT SEED, SCOUT RECORD, LIGHT ANALYTICS, isolated Stripe test Checkout, entitlement reconciliation, Billing Portal, cancellation, and cleanup.

Because later product/auth changes did occur, this historical Staging run is no longer used by itself to claim currentness for all current UI/auth behavior. Its unaffected lifecycle/billing evidence remains still-valid, while current app/auth behavior is refreshed by latest-main CI/CodeQL and Production Authenticated Smoke #109.

## Production authenticated path — PASS / CURRENT

Fresh decisive proof after the latest auth/product changes:

- Workflow: `NOVELIGHT Production Authenticated Smoke`
- Run: `33291747746` (#109)
- Approved/current main: `dbf0c5418262c8cec059c8b48cac3158a5e962ac`
- Fresh request/approval ledger: issue `#242`
- Conclusion: `success`
- OWNER approval: verified for the exact request/SHA
- Approval ledger: `CLAIMED` -> `CONSUMED`, `result="success"`; issue closed as completed
- Immediate approved-main re-check before Production write: `success`
- Authenticated Chrome smoke: `success`
- Ephemeral Production smoke-data cleanup and temporary-fixture cleanup: `success`

This proof is bound to the current audited main and re-establishes the authenticated Production scope after later auth/product changes. It must **not** be repeated merely to create a newer timestamp or refresh this document.

This refresh did not perform a Production migration deploy, repair-history, `supabase migration repair`, the current external Stripe webhook proof, Secrets/Environment changes, or a Stripe live charge.

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

No later material change to `api/stripe-webhook.js`, the decisive webhook-handler boundary, endpoint/signing-secret state, Production Supabase target, or proof implementation has been identified. The proof remains `current`; duplicate execution of the same Production mutation is prohibited.

## Production public/legal/read-only surfaces — PASS / CURRENT

Current audited-main read-only observation:

- Workflow: `NOVELIGHT Production Readiness Smoke`
- Run: `33291158004` (#54)
- Head: `dbf0c5418262c8cec059c8b48cac3158a5e962ac`
- Conclusion: `success`
- Full-route/read-only checks cover Production static-route convergence, safe API contracts, read-only Production reader behavior, Production beta observability, repository-to-Production root HTML consistency, and absence of old `NovelRise` branding.
- Intended terms, privacy, content-guidelines, billing-policy, commerce-disclosure, and contact routes and relevant signup/pricing links remain part of the reviewed public surface.

This exact latest-main proof supersedes the older Readiness #43 entry for current launch reliance. This is an engineering/read-only reachability observation, not legal advice.

## Legal / brand status — GO RECORDED WITH DEFERRED COUNSEL REVIEW

`docs/legal-beta-review.md` records:

- Qualified Japanese counsel review: **DEFERRED BY OWNER / STILL PENDING**.
- Explicit owner residual-risk decision: **RECORDED 2026-08-28**.
- Controlled public-beta GO: **RECORDED 2026-08-28**.
- The GO and residual-risk decision do not establish legal sufficiency or waive mandatory law, regulator, payment-provider, hosting/platform, or other applicable requirements.

## Checklist reconciliation

`docs/BETA-RELEASE-CHECKLIST.md` is reconciled in parallel with this rolling index.

All non-deferred hard checklist scopes have decisive current or still-valid evidence. An `[x]` means the scope is supported under the Evidence Freshness Gate; it does not imply every external operation was re-run on the current audited main.

No newly unknown non-deferred hard gate was identified during this 2026-08-30 reconciliation.

## Current release state

**Controlled public-beta: GO — CURRENT LAUNCH POSTURE RECONCILED 2026-08-30.**

Current audited behavioral evidence baseline: `dbf0c5418262c8cec059c8b48cac3158a5e962ac`.

Qualified counsel review remains an explicit post-launch deferred item and must not be silently converted to `completed`.

No additional Production mutation is authorized by this reconciliation. Existing Production/Secret/Stripe live/Supabase Production/Vercel Production approval boundaries remain in force, and already-current Production proof must not be repeated for documentary freshness.

If this reconciliation itself advances `main` only by updating release documentation, the current behavioral evidence remains valid because the proved product/Production/auth/billing/database/security/backup behavior does not change. If a later material product, Production, billing, auth, database/RLS, security, legal/public-surface, backup, or release-control change lands before or during the beta launch, refresh only the affected scope under `docs/EVIDENCE-FRESHNESS-GATE.md`.