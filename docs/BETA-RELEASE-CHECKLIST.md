# NOVELIGHT public-beta release checklist

This checklist is the final operational gate after code review/CI. A checked box must represent an observed result or a specifically justified still-valid result under `docs/EVIDENCE-FRESHNESS-GATE.md`, not an assumption.

**Reconciled: 2026-09-12 JST.**

Historical controlled public-beta GO remains recorded in `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Current material launch main at reconciliation: `e4e8673d6b45b046c69672a8e5fe72011c1a0081` (`Activate beta Standard before Production analytics smoke (#510)`).

**CURRENT LAUNCH POSTURE: GO — the technical and operational blockers recorded on 2026-09-10 have been cleared on exact current main.**

Qualified Japanese counsel review remains deferred/pending. The owner residual-risk decision is recorded in `docs/legal-beta-review.md`; this checklist does not assert legal sufficiency.

## Git / CI

- [x] Latest `main` and authoritative release/evidence rules were re-fetched before reconciliation.
- [x] Exact current main is `e4e8673d6b45b046c69672a8e5fe72011c1a0081`.
- [x] Exact-current NOVELIGHT CI / aggregate `check` / Node / static-quality gates are successful.
- [x] Desktop + mobile Playwright gates pass on exact-current main evidence.
- [x] Exact-current desktop and mobile async-UI browser gates are successful.
- [x] Exact-current CodeQL is successful.
- [x] Exact-current Vercel Production commit status is `success`.
- [x] Exact-current `production-readiness-smoke` status is `success`.
- [x] No selectively skipped job is represented as executed.

## Official thumbnail launch dependency

The 2026-09-10 release reconciliation correctly blocked launch while Production had no active official thumbnail. That historical blocker has now been cleared.

- [x] Official-thumbnail schema and privilege hardening remain part of Production state.
- [x] The launch official-thumbnail catalog is populated through the existing ADMIN path.
- [x] Production Readiness on exact current main passes with `active_official_thumbnails_present=true` and the remaining deterministic integrity checks passing.
- [x] New-novel creation using the official thumbnail flow is exercised by the fresh authenticated Production smoke.
- [x] Chapter 40 geometry thumbnail render/composition persistence is exercised by the same authenticated Production flow.
- [x] No placeholder-only asset is being used merely to force the readiness gate to pass.

The old 0-row / 0-active-row Production inspection remains historical evidence only. It must not be reused as current state after the successful 2026-09-12 readiness proof.

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
- [x] Changed authenticated Production behavior now has a fresh successful approval-gated Production Authenticated Smoke on exact current main.

## Chapter 40 Geometry Thumbnail Engine

- [x] `base_book + cover_quad` remains the Source of Truth.
- [x] PNG masks remain debug-only and are not the rendering authority.
- [x] `cover_texture` / `pattern` / `symbol` / `frame` are rendered through Perspective Transform.
- [x] `effect` may render outside the cover only through template configuration.
- [x] Geometry Validation remains mandatory.
- [x] ADMIN four-point drag editing, numeric input, and real-time preview remain the authoring boundary.
- [x] The shared Geometry Engine remains the basis for all official templates, with future `spine_quad` / `page_quad` / `edge_quad` extension points.
- [x] Production-authenticated novel creation, thumbnail render, and composition persistence passed.
- [x] Render-output cleanup completed after the smoke; temporary smoke state was not retained as launch content.

## Final authenticated smoke

Fresh current successful Production Authenticated Smoke:

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

Historical failed attempts #472 and #474 remain recorded as failures with successful cleanup. They are not rewritten as PASS; the newer exact-current successful proof supersedes them for current release readiness.

## Discovery / LIGHT ANALYTICS / posting / author home

- [x] Existing Free/Standard/Premium discovery behavior remains covered by current or still-valid evidence.
- [x] Trusted allocation receipts and server-authoritative PV counting remain part of Production state.
- [x] Official thumbnail schema/privilege hardening remains part of Production state.
- [x] Production has an active official-thumbnail path and new-novel submission completes in the authenticated smoke.
- [x] LIGHT ANALYTICS passes in the fresh exact-current authenticated smoke.
- [x] Beta Standard entitlement activation required by the analytics smoke is present on exact current main through PR #510.
- [x] Author-home public profile/avatar/recent-activity boundary remains part of Production state.
- [x] Current repository CI covers reader/author UI regressions.

## Content / moderation / ADMIN

- [x] AI-use classification and mature-content warning requirements remain in place.
- [x] Report submission/privacy and operator workflow remain covered by prior current/still-valid evidence.
- [x] ADMIN remains server-side authenticated/allowlisted under the existing boundary.
- [x] Chapter 38 ADMIN beta analytics has repository coverage.
- [x] Production Auth Smoke is not used to claim the ADMIN authorization boundary.

## Backup / restore — hard GO gate

- [x] Production Supabase scheduled-backup posture remains established.
- [x] `NOVELIGHT Production Backup Freshness` #8 / run `33354249864` remains the newest accepted read-only backup freshness proof.
- [x] Non-Production restore rehearsal remains recorded.
- [x] No reviewed Chapter 40 / smoke-fix change modifies the backup/restore control boundary.
- [x] Production restore is not repeated for documentary freshness.

## Beta pricing / Production billing

- [x] Standard beta pricing remains `0円` without required credit-card registration.
- [x] Premium beta special pricing remains `月額480円`.
- [x] Premium regular/formal price remains `月額1,980円`.
- [x] `NOVELIGHT Stripe Production Bootstrap` #7 / run `33612120034` remains the decisive live billing proof.
- [x] PRs #490, #497, #508, and #510 do not require a new Stripe live operation for this reconciliation.
- [x] Stripe live operations are not repeated solely for documentary freshness.

## Legal / brand / public surfaces

- [x] Terms, privacy, content guidelines, billing policy, commerce disclosure and contact remain public release surfaces.
- [x] Exact-current repository CI/CodeQL evidence and Vercel Production deployment status pass.
- [ ] Qualified Japanese counsel review is complete. **Deferred/pending by owner; accepted residual risk remains recorded.**

## Final release gate

- [x] Current material main is `e4e8673d6b45b046c69672a8e5fe72011c1a0081` at this reconciliation.
- [x] Production migration ledger/state, billing, backup, and unchanged operational boundaries have supportable current/still-valid evidence.
- [x] The former empty-official-thumbnail blocker is cleared by exact-current Production Readiness.
- [x] Production Readiness passes after official-thumbnail population.
- [x] Fresh approval-gated Production Authenticated Smoke proves the materially changed authenticated Production boundary on exact current main.
- [x] Chapter 40 Production-authenticated create/render/composition persistence verification is complete.
- [x] Cleanup and matching consumed-approval evidence are complete.
- [x] No duplicate Production mutation is required to refresh documentary state.

**Release posture after 2026-09-12 reconciliation: GO.**

This GO means the technical/operational release blockers tracked by this checklist are satisfied on current evidence. It does not convert the still-pending qualified Japanese counsel review into a legal PASS, and it does not authorize repeating already-completed Production migrations, smoke fixtures, Stripe operations, Secret changes, or other Production mutations.