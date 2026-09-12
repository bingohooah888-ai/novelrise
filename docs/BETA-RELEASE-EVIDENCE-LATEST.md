# NOVELIGHT β Release Evidence — Latest Reconciled State

**Reconciled: 2026-09-13 JST**

This file is the rolling current-state index required by `docs/EVIDENCE-FRESHNESS-GATE.md`. Dated `BETA-RELEASE-EVIDENCE-*.md` files remain historical snapshots and are not rewritten. Older proof is reused only when the current scope is demonstrated to be unchanged or materially equivalent.

## Release decision

**Historical controlled public-beta GO: RECORDED 2026-08-28.**

**Current launch posture: GO — PR #530 exact approved-head repository CI and CodeQL are green, exact-current `24df7347580c73648f31d6f4eaa7759689b228eb` is deployed successfully to Vercel Production, and exact-current Production Readiness #129 is green. The successful approval-gated Production Authenticated Smoke on `e4e8673d6b45b046c69672a8e5fe72011c1a0081` remains still-valid for the unchanged authenticated Chapter 38/40 beta-critical path.**

Decision record: `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Historical decision baseline main: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1`.

Current material launch main at this reconciliation: `24df7347580c73648f31d6f4eaa7759689b228eb` (`Clarify beta author onboarding from signup (#530)`).

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING** with owner residual risk recorded in `docs/legal-beta-review.md`. This is an operational release posture, not a finding of legal sufficiency.

## Why the 2026-09-10 BLOCKED snapshot is no longer current

The prior rolling evidence correctly recorded three technical blockers:

1. no active official thumbnail in Production;
2. Production Readiness had not yet passed after official-thumbnail population;
3. no fresh successful approval-gated Production Authenticated Smoke existed for the changed beta-critical flow.

Those statements were historical snapshots. Under `docs/EVIDENCE-FRESHNESS-GATE.md`, newer specific successful execution evidence supersedes them when no later material change invalidates the proof.

The blocker-clearing proof chain remains:

- official-thumbnail population was completed through the authorized Chapter 40 workstream;
- Production Readiness subsequently passed with `active_official_thumbnails_present=true` required by the deterministic integrity verdict;
- dedicated Production Auth Smoke issue #511 received OWNER approval for exact proof SHA `e4e8673d6b45b046c69672a8e5fe72011c1a0081`;
- approval-handler run `34692176490` completed `success` on the required `issue_comment` path;
- its single decisive `Verify authenticated beta-critical production flows` job completed `success`;
- #511 contains one matching GitHub-Actions-authored `NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED` record binding the request ID, proof SHA, run `34692176490`, and `result="success"`;
- cleanup completed and #511 was closed;
- no real Stripe charge was created by the smoke.

Later main commits now exist, so the #511 smoke is no longer described as exact-current execution. Instead, later changes are classified below to determine whether the SHA-bound proof remains valid for its scope.

## Later launch-hardening changes after the authenticated Production proof

The reviewed post-proof launch-hardening chain now includes:

- **PR #513 — Gate public signup during beta preregistration.** `PRE_REGISTRATION` hides normal signup and directs users to `/beta-authors`; once the campaign allows signup, the existing `auth.signUp()` metadata/profile flow remains unchanged. No Production DB, migration, Storage, Secret, Stripe, entitlement, or Supabase Auth configuration change was introduced.
- **PR #518 — Normalize preregistration release date to September 30.** Public release labeling is aligned to `2026年9月30日`; campaign state remains database-driven and no Production mutation is introduced.
- **PR #517 — Unify NOVELIGHT admin theme and reset registered active metrics.** ADMIN presentation/readability and registered-user activity presentation changed without a migration, DELETE/TRUNCATE, or ADMIN authentication/allowlist change.
- **PR #522 / #526 — Residual/final ADMIN readability passes.** These are presentation/readability changes and do not alter the authenticated Chapter 38/40 path, Production database state, billing, or Supabase Auth configuration.
- **PR #523 — Guard beta campaign state changes before launch.** ADMIN now requires an explicit confirmation when campaign state changes and shows the September 30 label. It does not change the Production schema or authenticated product path.
- **PR #525 — Document September 30 beta launch cutover.** Documentation-only launch-state cutover, verification, and rollback procedure; no Production state change.
- **PR #528 — Clarify beta invite status as manual outreach record.** ADMIN `invited` is explicitly a record of externally completed outreach; the change does not add email/DM infrastructure or mutate Auth/billing automatically.
- **PR #530 — Clarify beta author onboarding from signup.** Signup tells authors that beta Standard is free/cardless and self-service from pricing, and that confirmed authors can continue from 「創作室」. The existing `auth.signUp()` call, email redirect to `/index.html`, billing API, DB, Stripe, Secret, and entitlement logic remain unchanged.

None of PRs #513/#518/#517/#522/#523/#525/#526/#528/#530 modifies the authenticated novel-create / Chapter 40 Geometry Thumbnail Engine create-render-persistence / LIGHT ANALYTICS path exercised by Issue #511. Under `docs/EVIDENCE-FRESHNESS-GATE.md`, the #511 proof is therefore classified as **still-valid for that unchanged scope**, not as exact-current execution on `24df7347...`.

A post-merge `NOVELIGHT Production Auth Smoke Request` workflow can successfully create a request record for a newer SHA. Request creation alone is explicitly **not** authenticated Production PASS evidence. Without the required owner approval, successful decisive verification job, and matching consumed ledger record, it does not supersede Issue #511 and does not justify a duplicate Production Auth Smoke solely for SHA alignment.

No duplicate Production Auth Smoke, migration, asset registration, Stripe operation, Secret operation, or other Production mutation is justified merely to align proof SHA with current main.

## Freshness decision table

| Scope | Newest decisive proof | Freshness on current launch main | Status |
| --- | --- | --- | --- |
| Repository CI / browser regression | `NOVELIGHT CI` #2243 / run `34702951293` on PR #530 approved head `010de41c...` | reviewed-head content proof for the squash-merged application diff | PASS |
| CodeQL | `CodeQL` #2151 / run `34702951229` on PR #530 approved head `010de41c...` | reviewed-head content proof for the squash-merged application diff | PASS |
| Vercel Production deployment | commit status on `24df7347...` | exact-current | PASS |
| Official thumbnail availability | exact-current Production Readiness #129 | `active_official_thumbnails_present=true` remains required by the successful integrity verdict | PASS |
| Production Readiness | `NOVELIGHT Production Readiness Smoke` #129 / run `34703260352` on `24df7347...` | exact-current | PASS |
| Supabase Production migrations | reconciled Chapter 38 ledger plus already-applied `20260911123000_fix_thumbnail_asset_registration_path.sql` | current Production state; no rerun required | PASS |
| Production authenticated Chapter 38/40 beta-critical flows | Issue #511 / run `34692176490` on `e4e8673d...` | still-valid; later launch-hardening changes through #530 do not alter the proved path | PASS |
| Chapter 40 geometry thumbnail flow | Issue #511 / run `34692176490` | still-valid create/render/composition persistence proof | PASS |
| LIGHT ANALYTICS authenticated flow | Issue #511 / run `34692176490` | still-valid; later launch-hardening changes do not alter the proved analytics path | PASS |
| Public preregistration / launch cutover contract | PRs #518/#523/#525 plus exact-current Production Readiness and deployed public surface | current | PASS |
| First-author onboarding guidance | PR #530 plus runbook reconciliation | current; copy/operations only, Auth and entitlement behavior unchanged | PASS WITH SCOPE LIMIT |
| ADMIN presentation / campaign-operation safety | PRs #517/#522/#523/#526/#528 | current, with Production Auth Smoke explicitly not used to claim ADMIN authorization | PASS WITH SCOPE LIMIT |
| Stripe/billing | Stripe Production Bootstrap #7 / run `33612120034` | still-valid; later reviewed changes do not alter live billing | PASS |
| Backup/restore | Production Backup Freshness #8 / run `33354249864` plus recorded non-Production restore rehearsal | still-valid; no backup-control change | PASS |
| Legal counsel | owner-deferred | unchanged | PENDING / ACCEPTED RESIDUAL RISK |

## Git / CI — PASS

Current material launch main is `24df7347580c73648f31d6f4eaa7759689b228eb`.

The exact approved PR #530 head `010de41c10c3f7fe0a2eadad981b0eb087ba0365` passed:

- `NOVELIGHT CI` #2243 / run `34702951293`: `success`;
- aggregate `check`: `success`;
- Node tests: `success`;
- static quality: `success`;
- desktop browser smoke: `success`;
- mobile browser smoke: `success`;
- desktop async-UI browser coverage: `success`;
- mobile async-UI browser coverage: `success`;
- `CodeQL` #2151 / run `34702951229`: `success`.

GitHub then squash-merged the reviewed PR content to `24df7347...`. The squash SHA does not have a separate main-push CI/CodeQL execution recorded here, so this document does **not** call the PR-head CI/CodeQL “exact-current main-push” evidence. Instead, exact-current post-merge evidence is:

- Vercel Production commit status on `24df7347...`: `success`;
- `production-readiness-smoke` commit status on `24df7347...`: `success`;
- `NOVELIGHT Production Readiness Smoke` #129 / run `34703260352`: `success`, exact head SHA `24df7347...`;
- `NOVELIGHT High-Risk Merge Production Readiness Bridge` #24 / run `34703254069`: `success`.

Skipped deployment/mutation/audit jobs are not represented as executed.

## Official thumbnail launch dependency — PASS

The official-thumbnail schema and privilege hardening remain part of Production state.

The historical 2026-09-10 inspection found 0 official-thumbnail rows and correctly blocked the release. That state changed through the authorized Chapter 40 workstream.

Current decisive availability evidence is the successful exact-current Production Readiness #129 on `24df7347...`. `supabase/checks/production_beta_observability.sql` requires `active_official_thumbnails_present` as part of the final integrity verdict, based on an active row in `public.novel_thumbnail_assets`. The successful readiness result therefore establishes that the launch prerequisite is not empty.

The still-valid authenticated Production smoke on `e4e8673d...` exercised new-novel creation and Chapter 40 thumbnail behavior. Later launch-hardening PRs through #530 do not change that posting/rendering path.

Do not repeat asset registration or introduce placeholder content merely to refresh documentation.

## Supabase Production — PASS / CURRENT

Previously reconciled Production migrations through `20260910143000_chapter38_exclude_self_comment_scout_exp.sql` remain current state and are not rerun for documentary freshness.

Chapter 38 approval-ledger history remains recorded in earlier release evidence and the release checklist, including the foundation, lifecycle/rank, discovery, star-rating, comment, and self-comment-exclusion migrations.

Chapter 40 / official-thumbnail registration adds the following current state:

- PR #490 (`Fix official thumbnail asset registration path validation`) merged the hotfix migration `20260911123000_fix_thumbnail_asset_registration_path.sql`;
- the migration fixes the canonical official-thumbnail Storage-path validation in `novelight_admin_register_thumbnail_layer_asset` while preserving the service-role/SECURITY DEFINER boundary;
- `20260911123000_fix_thumbnail_asset_registration_path.sql` has already been applied in Production during the completed Chapter 40 workstream;
- later launch-hardening PRs through #530 add no new Production migration requirement;
- this reconciliation performs no Production migration and the already-applied migration must not be rerun.

The exact-current readiness result and still-valid authenticated create/render proof support the affected official-thumbnail path without requiring duplicate mutation.

## Chapter 38 product boundary — IMPLEMENTED / STILL-VALID AUTH PROOF PASS

Current code and Production state contain the beta foundations required by MASTER Chapter 38, including:

- replayable SCOUT event and EXP ledgers;
- valid-read sessions/events and anti-duplication rules;
- reader heartbeat/progress signaling;
- LIGHT SEED event attribution and send-time Rank capture;
- Work Rank calculation/history lifecycle and percentile logic;
- 180-day LIGHT SEED discovery EXP;
- star-rating SCOUT EXP;
- comment SCOUT EXP with self-comment exclusion;
- ADMIN beta analysis support;
- beta UI hiding SCOUT Level, Rank, badges, EXP, and unreleased SCOUT RECORD mechanics while keeping LIGHT SEED send history separate.

The materially changed authenticated Chapter 38 boundary has a successful approval-gated Production Authenticated Smoke: Issue #511 / run `34692176490`, bound to `e4e8673d...`. Later launch-hardening PRs through #530 do not modify this authenticated Chapter 38 behavior, so the proof remains still-valid for this scope.

## Chapter 40 Geometry Thumbnail Engine — PRODUCTION VERIFIED

Chapter 40 remains governed by the MASTER specification:

- `base_book + cover_quad` is the Source of Truth;
- PNG masks are debug-only, not rendering authority;
- `cover_texture` / `pattern` / `symbol` / `frame` use Perspective Transform;
- only template-configured `effect` rendering may extend outside the cover;
- Geometry Validation is mandatory;
- ADMIN supports four-point drag editing, numeric input, and real-time preview;
- future `spine_quad` / `page_quad` / `edge_quad` extension remains supported by the design;
- the Geometry Engine is the common foundation for all official templates.

Relevant implementation/proof chain includes:

- PR #490: fixes official-thumbnail asset registration path validation;
- PR #497: captures thumbnail render response bodies inside the response wait so the smoke can prove the render response reliably;
- PR #508: fixes the Production Auth Smoke LIGHT ANALYTICS heading selector;
- PR #510: activates beta Standard before the Production analytics smoke and produced proof SHA `e4e8673d...`;
- Issue #511 / run `34692176490`: verifies authenticated novel creation, Chapter 40 thumbnail render, composition persistence, and LIGHT ANALYTICS with successful cleanup.

Later launch-hardening PRs through #530 do not modify the Geometry Thumbnail Engine create/render/composition path. The #511 Production proof remains still-valid for that unchanged scope.

## Production authenticated beta-critical path — PASS / STILL VALID

Newest decisive authenticated request and execution for this scope:

- dedicated request issue: #511;
- request ID: `auth-smoke-e4e8673d6b45b046c69672a8e5fe72011c1a0081-34691803431`;
- approved proof SHA: `e4e8673d6b45b046c69672a8e5fe72011c1a0081`;
- approval author association: OWNER;
- approval-handler run: `34692176490`;
- workflow: `NOVELIGHT Production Auth Smoke Approval Handler`;
- trigger event: `issue_comment`;
- workflow conclusion: `success`;
- decisive job `Verify authenticated beta-critical production flows`: exactly one, `success`;
- desktop/mobile authenticated smoke: pass;
- Chapter 40 novel-create/render/composition persistence: pass;
- LIGHT ANALYTICS: pass;
- cleanup: pass;
- matching GitHub-Actions-authored consumed ledger record: exactly one, `result="success"`, same request ID, same run ID, same exact proof SHA;
- issue #511: closed after consumption;
- Stripe live charge: none.

This evidence set matches the acceptance contract in `scripts/evaluate-production-auth-smoke-evidence.mjs` for its exact required SHA. It is not rewritten as an execution on current main `24df7347...`.

Evidence-freshness review of later launch-hardening PRs through #530 found no change to the authenticated product path proved above. The proof is therefore still-valid for that scope, and repeating the Production Auth Smoke solely for SHA freshness is prohibited as unnecessary duplicate Production work.

A successful `NOVELIGHT Production Auth Smoke Request` workflow for a newer SHA proves only that the request was created. It is not a successful authenticated Production execution and is not listed above as PASS evidence.

Historical attempts #472 and #474 remain failures with successful cleanup. They are retained for audit and are not relabeled. Their older failed status no longer overrides the later successful proof for the unchanged authenticated scope.

## Public signup / preregistration launch hardening — PASS WITH EXPLICIT BOUNDARY

PR #513 prevents the ordinary NOVELIGHT web signup UI from advertising general registration while the existing beta-author campaign is still `PRE_REGISTRATION`:

- `PRE_REGISTRATION`: normal signup form remains hidden and users are directed to `/beta-authors`;
- `BETA_OPEN` or `CLOSED`: the existing signup form is exposed;
- unknown or failed campaign-state lookup: fail closed;
- existing login remains available;
- existing `auth.signUp()` metadata/profile flow remains unchanged once signup is enabled.

This is a **public UI launch gate only**. It is not a cryptographic/service-level shutdown of the public Supabase Auth endpoint, and this evidence does not claim otherwise.

PR #518 aligns the public preregistration release label with the MASTER date `2026年9月30日`. PR #523 guards campaign-state transitions with an explicit ADMIN confirmation. PR #525 documents the operator-safe September 30 cutover and rollback path. PR #528 makes the manual-outreach milestone truthful. PR #530 then improves author onboarding copy while leaving the existing Auth redirect and Standard entitlement activation mechanism unchanged.

## First-author onboarding / milestone operations — RECONCILED

Current operational contract after PR #530 and the runbook reconciliation is:

- ADMIN `invited` / 「案内送付記録済み」 records outreach that was actually completed through an external channel; ADMIN itself does not send the email/DM;
- signup uses the existing confirmation-email flow and the author is told to continue from 「創作室」 after confirmation;
- beta Standard remains self-service from pricing through `Standardを無料で利用`, with no card required during beta;
- ordinary beta Standard activation is not performed by manually changing Stripe or Production DB state;
- `registered_at` / 「本登録済み」 and `first_novel_at` / 「初投稿済み」 are operator-confirmed milestones and are not inferred from preregistration or outreach alone;
- the current contract does not represent preregistration email-to-Auth matching as automatic;
- Founding Authors eligibility is determined by the qualifying real-author publication flow rather than manual reservation from preregistration order;
- preregistration PII is not copied into GitHub/chat evidence to prove conversion.

This reconciliation changes documentation only; it does not create new account-linking, mail-delivery, entitlement, or Founding Authors logic.

## LIGHT ANALYTICS / discovery / posting / author home — PASS

Current evidence supports the beta-critical user path:

- active official-thumbnail availability is present and exact-current Production Readiness #129 passes;
- new-novel submission completed in the still-valid authenticated smoke on `e4e8673d...`;
- Chapter 40 rendering/persistence completed in that same proof;
- LIGHT ANALYTICS passed after the PR #510 beta Standard entitlement activation;
- later launch-hardening changes through #530 do not modify that authenticated analytics path;
- existing discovery, trusted allocation receipt, server-authoritative PV, author-profile/avatar/recent-activity boundaries remain covered by current or specifically still-valid evidence;
- PR #530 approved-head CI covers reader/author UI regression scope before squash merge.

## Content / moderation / ADMIN — PASS WITH SCOPE LIMIT

Previously established content classification/warning/report privacy and ADMIN allowlist controls remain in force. Chapter 38 ADMIN beta analytics has repository coverage.

The later ADMIN hardening chain includes:

- PR #517: shared NOVELIGHT ADMIN theme, larger/higher-contrast controls, registered-user active cards, non-destructive activity reset boundary;
- PR #522/#526: residual/final readability hierarchy cleanup;
- PR #523: campaign-state confirmation guard;
- PR #528: truthful manual outreach status semantics.

None of those changes adds a migration, DELETE/TRUNCATE of historical analytics, email/DM delivery infrastructure, or an ADMIN authentication/allowlist change.

Exact-current Vercel Production and Production Readiness #129 are green after PR #530. Production Auth Smoke is deliberately **not** used to claim the ADMIN authorization boundary.

## Production billing / Stripe / entitlement — PASS / STILL VALID

The beta billing contract remains:

- Standard: beta period `0円`, credit card not required, self-service activation from pricing;
- Premium: beta special price `月額480円`;
- Premium regular/formal price: `月額1,980円`.

Decisive live billing proof remains `NOVELIGHT Stripe Production Bootstrap` #7 / run `33612120034`, conclusion `success`.

Later launch-hardening PRs through #530 do not create a reason to repeat a Stripe live operation for documentary freshness. PR #530 only clarifies the existing Standard activation path; it does not add signup-time entitlement activation. The successful Production Auth Smoke created no real Stripe charge.

## Backup / restore — PASS / STILL VALID

Newest accepted read-only backup evidence remains `NOVELIGHT Production Backup Freshness` #8 / run `33354249864`, conclusion `success`, together with the previously recorded non-Production restore rehearsal and `docs/BACKUP-RESTORE-RUNBOOK.md`.

No reviewed Chapter 40, signup-gate, public release-label, ADMIN, campaign-state, or onboarding-copy change modifies the backup/restore control boundary. No Production restore or backup mutation is repeated.

## Legal / brand status

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING**. The recorded owner residual-risk decision remains historical and explicit. Nothing in this evidence file asserts legal sufficiency.

The public preregistration release label follows the MASTER date `2026年9月30日`, and the launch runbook now records the corresponding campaign-state cutover and first-author operating path.

## Checklist reconciliation

`docs/BETA-RELEASE-CHECKLIST.md` is reconciled in parallel with this rolling index.

An `[x]` means current or specifically justified still-valid evidence exists. An `[ ]` means proof is missing/stale or a manual/external gate is still open. Historical failed proof remains failed; it is superseded for current-state classification only by newer evidence for the same scope.

## Current release state

**CURRENT LAUNCH POSTURE: GO as of 2026-09-13 reconciliation.**

Current material main: `24df7347580c73648f31d6f4eaa7759689b228eb`.

Current/reconciled quality, deployment, and readiness evidence is green:

- PR #530 `NOVELIGHT CI` #2243 / run `34702951293` on approved head `010de41c...`: success;
- PR #530 `CodeQL` #2151 / run `34702951229`: success;
- exact-current Vercel Production commit status on `24df7347...`: success;
- exact-current `NOVELIGHT Production Readiness Smoke` #129 / run `34703260352`: success;
- exact-current `production-readiness-smoke` commit status: success.

The PR-head CI/CodeQL are retained as reviewed-content proof and are not mislabeled as a separate main-push execution on the GitHub-generated squash SHA.

The former release blockers remain resolved: official-thumbnail availability is present, exact-current Production Readiness passes, and the approval-gated Production Authenticated Smoke on `e4e8673d...` remains still-valid for the unchanged authenticated Chapter 38/40 scope after review of later launch-hardening PRs through #530.

No duplicate Production operation is needed to support this release-state conclusion. In particular, do not rerun `20260911123000_fix_thumbnail_asset_registration_path.sql`, do not repopulate official assets merely for documentary freshness, and do not repeat Auth Smoke/Stripe/Secret operations unless a later material change actually invalidates the relevant proof under `docs/EVIDENCE-FRESHNESS-GATE.md`.

The remaining qualified Japanese counsel review is still pending under the previously recorded owner residual-risk decision; this GO is technical/operational and does not assert legal sufficiency.
