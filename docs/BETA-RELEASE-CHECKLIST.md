# NOVELIGHT public-beta release checklist

This checklist is the final operational gate after code review/CI. A checked box must represent an observed result or a specifically justified still-valid result under `docs/EVIDENCE-FRESHNESS-GATE.md`, not an assumption.

**Reconciled: 2026-09-13 JST.**

Historical controlled public-beta GO remains recorded in `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Current material launch main at reconciliation: `24df7347580c73648f31d6f4eaa7759689b228eb` (`Clarify beta author onboarding from signup (#530)`).

**CURRENT LAUNCH POSTURE: GO — the PR #530 approved head passed full repository CI and CodeQL, exact-current `24df7347...` is deployed to Vercel Production, and exact-current Production Readiness #129 is green. The successful approval-gated Production Authenticated Smoke on `e4e8673d6b45b046c69672a8e5fe72011c1a0081` remains still-valid for the unchanged authenticated Chapter 38/40 beta-critical path.**

Qualified Japanese counsel review remains deferred/pending. The owner residual-risk decision is recorded in `docs/legal-beta-review.md`; this checklist does not assert legal sufficiency.

## Git / CI

- [x] Latest `main` and authoritative release/evidence rules were re-fetched before reconciliation.
- [x] Exact current main is `24df7347580c73648f31d6f4eaa7759689b228eb`.
- [x] PR #530 exact approved head `010de41c10c3f7fe0a2eadad981b0eb087ba0365` passed `NOVELIGHT CI` #2243 / run `34702951293`.
- [x] PR #530 CI aggregate `check`, Node tests, static quality, desktop/mobile smoke, and desktop/mobile async-UI jobs are successful.
- [x] Desktop + mobile Playwright gates pass for both smoke and async-UI coverage on PR #530 approved head.
- [x] PR #530 exact approved head passed `CodeQL` #2151 / run `34702951229`.
- [x] GitHub squash merge produced exact current main `24df7347...` from the reviewed PR #530 content; the merge itself adds no additional application change beyond the approved PR diff.
- [x] Exact-current Vercel Production commit status on `24df7347...` is `success`.
- [x] Exact-current `NOVELIGHT Production Readiness Smoke` #129 / run `34703260352` completed `success`.
- [x] Exact-current `production-readiness-smoke` commit status is `success`.
- [x] No selectively skipped job is represented as executed.

The PR CI/CodeQL evidence above is not mislabeled as a separate main-push execution on the squash SHA. Exact-current deployment and Production Readiness are independently recorded on `24df7347...`.

## Later launch-hardening changes after the authenticated Production proof

The successful Production Authenticated Smoke is SHA-bound to `e4e8673d6b45b046c69672a8e5fe72011c1a0081`. Later main commits were reviewed for whether they invalidate that proof under `docs/EVIDENCE-FRESHNESS-GATE.md`.

- [x] PR #513 gates the public `signup.html` UI during `PRE_REGISTRATION`, preserves the existing signup flow once enabled, and does not change the authenticated Chapter 38/40 product path, Production DB, migration, Storage, Secret, Stripe, entitlement, or Supabase Auth configuration.
- [x] PR #518 normalizes the public preregistration release label to `2026年9月30日`; campaign state remains database-driven and no Production mutation is introduced.
- [x] PR #517 updates ADMIN presentation/readability and the registered-user activity overview; it does not change ADMIN authentication/allowlist behavior, perform a migration, or destructively delete historical analytics rows.
- [x] PR #522 and PR #526 are residual/final ADMIN readability work and do not change the authenticated product path, Production database state, billing, or Supabase Auth configuration.
- [x] PR #523 adds an operator confirmation guard for campaign-state changes and aligns the ADMIN release-label placeholder to September 30; it does not change the Production schema or authenticated Chapter 38/40 flow.
- [x] PR #525 is documentation-only and records the September 30 campaign cutover, verification, and rollback procedure.
- [x] PR #528 makes the preregistration ADMIN truthful that `invited` is a manual record of externally completed outreach; it does not add mail/DM infrastructure or change Auth, billing, or Production data automatically.
- [x] PR #530 adds author-onboarding guidance to `signup.html`: beta Standard is free/cardless and self-service through pricing, and confirmed authors can continue from 「創作室」. The existing `auth.signUp()` call, `/index.html` email redirect, billing API, DB, Stripe, Secret, and entitlement logic are unchanged.
- [x] None of PRs #513/#518/#517/#522/#523/#525/#526/#528/#530 changes the authenticated novel-create / Geometry Thumbnail Engine / LIGHT ANALYTICS path exercised by Issue #511 / run `34692176490`.
- [x] The #511 Production Authenticated Smoke is therefore retained as **still-valid scope proof**, not relabeled as exact-current execution on `24df7347...`.
- [x] A post-merge `NOVELIGHT Production Auth Smoke Request` workflow may create a request record for the new SHA; request-only workflow success is **not** authenticated Production PASS evidence and does not supersede Issue #511 without the required owner approval, decisive verification job, and consumed ledger record.
- [x] No duplicate Production Auth Smoke is run solely to make the documentary proof SHA equal current main.

## Official thumbnail launch dependency

The 2026-09-10 release reconciliation correctly blocked launch while Production had no active official thumbnail. That historical blocker has now been cleared.

- [x] Official-thumbnail schema and privilege hardening remain part of Production state.
- [x] The launch official-thumbnail catalog is populated through the existing ADMIN path.
- [x] Exact-current Production Readiness #129 on `24df7347...` passes, preserving the deterministic `active_official_thumbnails_present=true` launch prerequisite and the remaining integrity checks.
- [x] New-novel creation using the official thumbnail flow was exercised by the still-valid authenticated Production smoke on `e4e8673d...`.
- [x] Chapter 40 geometry thumbnail render/composition persistence was exercised by the same authenticated Production flow.
- [x] No later reviewed change invalidates that create/render/composition proof.
- [x] No placeholder-only asset is being used merely to force the readiness gate to pass.

The old 0-row / 0-active-row Production inspection remains historical evidence only. It must not be reused as current state after the successful readiness proof.

## Supabase Production

Previously reconciled Production migrations through `20260910143000_chapter38_exclude_self_comment_scout_exp.sql` remain part of current Production state.

Chapter 38 Production state remains reconciled:

- [x] `20260909071500_scout_beta_event_foundations.sql` and `20260909071510_scout_beta_rules_rls.sql` are covered by issue #165 / bridge run `34315738396`, mutation/postcheck `success`.
- [x] `20260909080000_disable_light_seed_v1_client_rpcs.sql` was applied during the Chapter 38 Production rollout and is not repeated for documentary freshness.
- [x] `20260909100000_chapter38_work_rank_engine.sql` was applied during the Chapter 38 Production rollout and is not repeated for documentary freshness.
- [x] `20260909120000_chapter38_work_rank_lifecycle.sql` is covered by issue #165 / bridge run `34335400168`, mutation/postcheck `success`.
- [x] `20260909130000_chapter38_rank_bayesian_percentiles.sql` is covered by issue #165 / bridge run `34340585331`, mutation/postcheck `success`.
- [x] `20260909140000_chapter38_seed_discovery_exp.sql` is covered by issue #165 / bridge run `34358566221`, mutation/postcheck `success`.
- [x] `20260909190000_chapter38_star_rating_scout_exp.sql` is covered by issue #460 / bridge run `34408554615`, `result="success"`, mutation/postcheck `success`.
- [x] `20260910070000_chapter38_comment_scout_exp_foundation.sql` is covered by issue #460 / bridge run `34413902759`, mutation/postcheck `success`.
- [x] `20260910143000_chapter38_exclude_self_comment_scout_exp.sql` is covered by issue #460 / bridge run `34441780108`, `result="success"`, mutation/postcheck `success`.

Chapter 40 / official-thumbnail registration state:

- [x] PR #490 introduced `20260911123000_fix_thumbnail_asset_registration_path.sql` to fix the valid official-thumbnail Storage-path registration boundary.
- [x] `20260911123000_fix_thumbnail_asset_registration_path.sql` is already applied in Production and is treated as current state.
- [x] The migration is **not** rerun for documentary freshness or release reconciliation.
- [x] PRs #513/#518/#517/#522/#523/#525/#526/#528/#530 introduce no Production migration requirement.
- [x] No Production database mutation is performed by this reconciliation.

## Chapter 38 beta behavior

- [x] Replayable SCOUT event/EXP ledger foundations exist.
- [x] Valid-read sessions/events and reader-side heartbeat/progress signaling are implemented.
- [x] LIGHT SEED send-time Rank/event attribution is implemented.
- [x] Work Rank engine/history/lifecycle and percentile logic are implemented.
- [x] 180-day discovery EXP is implemented.
- [x] Star-rating EXP is implemented.
- [x] Comment EXP and self-comment exclusion are implemented.
- [x] ADMIN beta analysis support is implemented.
- [x] Beta UI does not expose SCOUT Level, Rank, badges, EXP, or unreleased SCOUT RECORD mechanics.
- [x] LIGHT SEED send history is presented separately from unreleased SCOUT RECORD.
- [x] The materially changed authenticated Chapter 38 boundary retains a successful, still-valid approval-gated Production Authenticated Smoke: Issue #511 / run `34692176490` on `e4e8673d...`.

## Chapter 40 Geometry Thumbnail Engine

- [x] `base_book + cover_quad` remains the Source of Truth.
- [x] PNG masks remain debug-only and are not the rendering authority.
- [x] `cover_texture` / `pattern` / `symbol` / `frame` are rendered through Perspective Transform.
- [x] `effect` may render outside the cover only through template configuration.
- [x] Geometry Validation remains mandatory.
- [x] ADMIN four-point drag editing, numeric input, and real-time preview remain the authoring boundary.
- [x] The shared Geometry Engine remains the basis for all official templates, with future `spine_quad` / `page_quad` / `edge_quad` extension points.
- [x] Production-authenticated novel creation, thumbnail render, and composition persistence passed on the still-valid proof SHA `e4e8673d...`.
- [x] Render-output cleanup completed after the smoke; temporary smoke state was not retained as launch content.
- [x] Later PRs through #530 do not modify the Geometry Thumbnail Engine create/render/composition path.

## Production Authenticated Smoke — still-valid scope proof

Newest successful Production Authenticated Smoke for the authenticated Chapter 38/40 beta-critical path:

- [x] Dedicated approval issue: #511.
- [x] Exact approved/head main: `e4e8673d6b45b046c69672a8e5fe72011c1a0081`.
- [x] OWNER approval is recorded on the dedicated request.
- [x] Approval was claimed once and bound to run `34692176490`.
- [x] Workflow is `NOVELIGHT Production Auth Smoke Approval Handler` on the required `issue_comment` path.
- [x] Decisive `Verify authenticated beta-critical production flows` job completed `success`.
- [x] Desktop and mobile authenticated smoke passed.
- [x] Chapter 40 official-thumbnail / geometry thumbnail creation-render-persistence flow passed.
- [x] LIGHT ANALYTICS smoke passed.
- [x] Ephemeral Production smoke-data cleanup succeeded.
- [x] Temporary Production credentials / fixture cleanup succeeded.
- [x] The dedicated issue contains exactly one matching GitHub-Actions-authored `NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED` record for run `34692176490`, main `e4e8673d6b45b046c69672a8e5fe72011c1a0081`, `result="success"`.
- [x] Issue #511 is closed after consumption.
- [x] No Stripe live charge was created by the smoke.
- [x] Under evidence-freshness review, later launch-hardening PRs through #530 do not invalidate this proof scope.
- [x] This smoke is **not** represented as an exact-current execution on `24df7347...`.

Historical failed attempts #472 and #474 remain recorded as failures with successful cleanup. They are not rewritten as PASS; the newer successful proof supersedes them for the unchanged authenticated scope.

## Discovery / LIGHT ANALYTICS / posting / author home

- [x] Existing Free/Standard/Premium discovery behavior remains covered by current or still-valid evidence.
- [x] Trusted allocation receipts and server-authoritative PV counting remain part of Production state.
- [x] Official thumbnail schema/privilege hardening remains part of Production state.
- [x] Production has an active official-thumbnail path; exact-current Production Readiness #129 remains green.
- [x] New-novel submission completed in the still-valid authenticated smoke on `e4e8673d...`.
- [x] LIGHT ANALYTICS passed in that same still-valid authenticated smoke.
- [x] Beta Standard entitlement activation required by the analytics smoke remains present through PR #510 and is not changed by later launch-hardening PRs through #530.
- [x] PR #530 clarifies the existing beta Standard self-service activation path without moving entitlement activation into signup.
- [x] Author-home public profile/avatar/recent-activity boundary remains part of Production state.
- [x] PR #530 approved-head CI covers reader/author UI regression scope before the squash merge.

## Preregistration / first-author operations

- [x] Public preregistration campaign state is database-driven and the server-side submission boundary accepts new preregistration only in `PRE_REGISTRATION`.
- [x] ADMIN campaign-state changes require an explicit operator confirmation when the state changes.
- [x] The September 30 launch procedure uses the authenticated ADMIN transition `PRE_REGISTRATION -> BETA_OPEN`, not direct Production SQL.
- [x] ADMIN `invited` represents externally completed outreach recorded manually; ADMIN itself does not send email or DM.
- [x] `registered_at` / 「本登録済み」 and `first_novel_at` / 「初投稿済み」 remain operator-confirmed conversion milestones; preregistration/outreach alone does not prove them.
- [x] Current preregistration status handling is not represented as automatic prereg-email-to-Auth matching.
- [x] Beta Standard remains self-service from pricing (`Standardを無料で利用`) and requires no card during the beta; ordinary activation does not require manual Stripe or Production DB edits.
- [x] Founding Authors eligibility is not manually reserved from preregistration order; the qualifying real-author publication flow determines eligibility.
- [x] `docs/BETA-OPERATIONS-RUNBOOK.md` records these onboarding/milestone rules and prohibits copying preregistration PII into GitHub/chat evidence.

## Content / moderation / ADMIN

- [x] AI-use classification and mature-content warning requirements remain in place.
- [x] Report submission/privacy and operator workflow remain covered by prior current/still-valid evidence.
- [x] ADMIN remains server-side authenticated/allowlisted under the existing boundary.
- [x] Chapter 38 ADMIN beta analytics has repository coverage.
- [x] PR #517/#522/#526 change ADMIN theme/readability without changing ADMIN authentication/allowlist behavior.
- [x] PR #523 adds a campaign-state confirmation guard without changing the authorization boundary.
- [x] PR #528 makes manual outreach recording explicit and does not add automated messaging infrastructure.
- [x] Exact-current Vercel Production and Production Readiness #129 are green after PR #530.
- [x] Production Auth Smoke is not used to claim the ADMIN authorization boundary.

## Backup / restore — hard GO gate

- [x] Production Supabase scheduled-backup posture remains established.
- [x] `NOVELIGHT Production Backup Freshness` #8 / run `33354249864` remains the newest accepted read-only backup freshness proof.
- [x] Non-Production restore rehearsal remains recorded.
- [x] No reviewed Chapter 40 / signup-gate / release-label / ADMIN / onboarding-copy change modifies the backup/restore control boundary.
- [x] Production restore is not repeated for documentary freshness.

## Beta pricing / Production billing

- [x] Standard beta pricing remains `0円` without required credit-card registration.
- [x] Standard beta entitlement remains self-service through the pricing action; PR #530 only clarifies that existing path.
- [x] Premium beta special pricing remains `月額480円`.
- [x] Premium regular/formal price remains `月額1,980円`.
- [x] `NOVELIGHT Stripe Production Bootstrap` #7 / run `33612120034` remains the decisive live billing proof.
- [x] Later launch-hardening PRs through #530 do not require a new Stripe live operation for this reconciliation.
- [x] Stripe live operations are not repeated solely for documentary freshness.

## Legal / brand / public surfaces

- [x] Terms, privacy, content guidelines, billing policy, commerce disclosure and contact remain public release surfaces.
- [x] Public preregistration release labeling follows the MASTER date `2026年9月30日`.
- [x] Signup now explains the beta Standard/cardless activation path and post-confirmation 「創作室」 continuation without changing the Auth redirect or entitlement logic.
- [x] Exact-current Vercel Production and Production Readiness #129 pass on `24df7347...`; PR #530 approved-head CI/CodeQL passed before squash merge.
- [ ] Qualified Japanese counsel review is complete. **Deferred/pending by owner; accepted residual risk remains recorded.**

## Final release gate

- [x] Current material main is `24df7347580c73648f31d6f4eaa7759689b228eb` at this reconciliation.
- [x] PR #530 approved head passed `NOVELIGHT CI` #2243 and `CodeQL` #2151; exact-current Vercel Production and `Production Readiness Smoke` #129 pass.
- [x] Production migration ledger/state, billing, backup, and unchanged operational boundaries have supportable current/still-valid evidence.
- [x] The former empty-official-thumbnail blocker remains cleared by exact-current Production Readiness.
- [x] The successful approval-gated Production Authenticated Smoke on `e4e8673d...` remains still-valid for the unchanged authenticated Chapter 38/40 boundary after review of later launch-hardening PRs through #530.
- [x] Chapter 40 Production-authenticated create/render/composition persistence verification remains valid for that unchanged scope.
- [x] Cleanup and matching consumed-approval evidence are complete.
- [x] A request-only Auth Smoke workflow for a newer SHA is not treated as authenticated PASS and does not require approval solely for documentary SHA freshness.
- [x] No duplicate Production mutation or Auth Smoke is required merely to refresh documentary SHA alignment.

**Release posture after 2026-09-13 reconciliation: GO.**

This GO means the technical/operational release blockers tracked by this checklist are satisfied on current and specifically justified still-valid evidence. It does not convert the still-pending qualified Japanese counsel review into a legal PASS, and it does not authorize repeating already-completed Production migrations, smoke fixtures, Stripe operations, Secret changes, or other Production mutations.
