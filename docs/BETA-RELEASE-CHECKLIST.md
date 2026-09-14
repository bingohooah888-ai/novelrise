# NOVELIGHT public-beta release checklist

This checklist is the operational release gate after code review/CI. A checked box represents an observed result or a specifically justified still-valid result under `docs/EVIDENCE-FRESHNESS-GATE.md`, not an assumption.

**Reconciled: 2026-09-14 JST.**

Historical controlled public-beta GO remains recorded in `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Current repository main at this reconciliation: `69ed457c8a057fdb9fe69d05c03b078d164b370c` (`Fix per-work favorite conversion rate (#557)`).

**CURRENT TECHNICAL/OPERATIONAL LAUNCH POSTURE: GO WITH SCOPE-LIMITED HISTORICAL PROOF.** Current repository CI/CodeQL and Vercel Production evidence are green through PR #557. Older Production Auth/Readiness evidence is reused only for unchanged scope and is not represented as execution of later behavior it did not exercise.

Qualified Japanese counsel review remains deferred/pending. The owner residual-risk decision remains recorded in `docs/legal-beta-review.md`; this checklist does not assert legal sufficiency.

## Current main / Git / CI

- [x] Latest `main` was re-fetched before reconciliation.
- [x] Exact current main is `69ed457c8a057fdb9fe69d05c03b078d164b370c`.
- [x] PR #557 is squash-merged; merge SHA equals current main `69ed457c...`.
- [x] NOVELIGHT CI #2327 is `SUCCESS` on the current merged state.
- [x] Required aggregate `check` is `SUCCESS`.
- [x] CodeQL #2234 is `SUCCESS` on the current merged state.
- [x] PR #557 approved head `50380cb4074fbba9f460a93690a4f3d9e52b613c` independently passed NOVELIGHT CI #2326.
- [x] PR #557 approved head independently passed CodeQL #2233.
- [x] No selectively skipped job is represented as executed.

## Vercel / deployment evidence

- [x] Vercel Production commit status for current main `69ed457c...` is `SUCCESS`.
- [x] The rolling release evidence distinguishes exact-current deployment evidence from older scope-limited Production verification.
- [x] No manual Vercel Production mutation or redeploy is performed merely for documentation freshness.

## MASTER Chapter 41 / reader beta behavior

- [x] Work Rank remains internally calculated/stored for discovery and later SCOUT use.
- [x] Beta ordinary reader/author UI does not expose Rank 1–6 / EMBER–NOVA as current Work Rank.
- [x] Internal Rank may still be used to form beta discovery candidate groups without showing the internal Rank label.
- [x] SCOUT Level, SCOUT Rank, badges, and XP remain unreleased/locked during beta.
- [x] A SCOUT RECORD preview must not leak hidden real progression values.
- [x] LIGHT SEED send history remains separated from unreleased SCOUT RECORD mechanics.
- [x] PR #539 preserves safe reader context across login/signup.
- [x] PR #542 aligns Production Auth Smoke navigation with the Chapter 41 LIGHT SEED-history split.

## LIGHT READY

- [x] PR #547 implements beta LIGHT READY pre-publication checks.
- [x] LIGHT READY is treated as a beta hardening aid and not as proof that every later Production path was exercised by an older smoke.

## LIGHT ANALYTICS / beta-A funnel

- [x] Basic impression/exposure measurement exists.
- [x] Basic work-detail CTR / arrival measurement exists.
- [x] Reading-start / first-episode progression measurement exists.
- [x] Episode-2 continuation measurement exists.
- [x] Favorite conversion measurement exists.
- [x] PR #549 adds trusted public impression receipts for beta analytics/discovery surfaces.
- [x] PR #551 adds migration safety artifacts for the trusted-impression change.
- [x] PR #555 fixes warning-gated work-detail-open analytics and adds regression coverage.
- [x] PR #557 fixes the per-work favorite conversion denominator to **favorites / impressions**.
- [x] Per-work favorite conversion no longer uses episode-2 continuation as its denominator.
- [x] Regression coverage prevents drift back to the former denominator.
- [x] Advanced benchmarking, automatic diagnosis, and AI improvement advice are not incorrectly treated as mandatory beta-A completion criteria.

## Official thumbnail / public lookup

- [x] Chapter 40 Geometry Thumbnail Engine remains the official thumbnail rendering basis.
- [x] Existing official-thumbnail Production setup remains previously established state and is not remutated for freshness.
- [x] PR #553 restores/guards bounded public official-thumbnail lookup for search/ranking surfaces.
- [x] PR #553 aligns Staging thumbnail smoke coverage with the Chapter 40 composer.
- [x] Authenticated Chapter 40 create/render/composition persistence remains supported only by the actual scope of the older successful Production Auth Smoke.
- [x] No asset registration or Production thumbnail mutation is repeated for this reconciliation.

## Production Authenticated Smoke — scope-limited proof

- [x] Dedicated successful approval-gated proof remains Issue #511 / run `34692176490` on `e4e8673d6b45b046c69672a8e5fe72011c1a0081`.
- [x] The proof remains usable for the Chapter 38/40 behavior it actually executed where later changes did not invalidate that path.
- [x] The proof is **not** relabeled as an execution on current main `69ed457c...`.
- [x] The proof is not used as direct evidence for later Chapter 41 presentation behavior.
- [x] The proof is not used as direct evidence for LIGHT READY added by PR #547.
- [x] The proof is not used as direct evidence for trusted public impression receipts added by PR #549.
- [x] The proof is not used as direct evidence for public thumbnail lookup changes in PR #553.
- [x] The proof is not used as direct evidence for analytics fixes in PR #555/#557.
- [x] No Production Auth Smoke is rerun solely to align the proof SHA with current `main`.
- [x] Request-only workflow success is never classified as authenticated Production PASS without the required decisive verification job and matching consumed ledger record.

## Production Readiness

- [x] Latest reconciled Production Readiness #141 is retained as current-by-scope evidence.
- [x] Production Readiness is not overstated as exact-current proof of later analytics-only behavior that it did not specifically exercise.
- [x] No Production mutation is performed to refresh the readiness timestamp.

## Supabase Production / migration state

- [x] Previously reconciled Chapter 38 and Chapter 40 migrations remain historical/current-by-scope evidence and are not rerun for documentation freshness.
- [x] Successful Production ledger evidence is recorded for migration ID `20260913112358`.
- [x] Successful Production ledger evidence is recorded for migration ID `20260913141000`.
- [x] Neither migration is rerun by Issue #558.
- [x] No new Production migration is introduced by this docs-only reconciliation.
- [x] No Production DB data mutation is performed.
- [x] No RLS/permission boundary is changed.

## Backup / recovery

- [x] Newest reconciled backup freshness evidence is Production Backup Freshness #65 / run `34829215089`.
- [x] Existing restore/recovery proof remains scope-limited historical evidence unless a later control-path change invalidates it.
- [x] No restore or destructive recovery test is performed by this reconciliation.

## Stripe / billing / entitlements

- [x] The post-#530 changes reconciled here do not require a Stripe live mutation.
- [x] No pricing or entitlement change is introduced by Issue #558.
- [x] No Secret/environment-variable mutation is performed.
- [x] Existing Stripe Production evidence remains historical/current-by-scope unless a future billing-path change invalidates it.

## Legal / policy residual risk

- [ ] Qualified Japanese counsel review completed.

Current classification: **PENDING / OWNER-DEFERRED / ACCEPTED RESIDUAL RISK**. This unchecked item is intentionally not converted into a legal PASS.

## Issue #558 reconciliation safety

- [x] Scope remained docs/release-hardening only.
- [x] No concrete P0/P1 product/security/DB/auth/billing defect was proven during reconciliation.
- [x] No product-code change was made.
- [x] No Production Supabase/DB mutation was made.
- [x] No migration was executed or rerun.
- [x] No Stripe/billing/entitlement mutation was made.
- [x] No Secret/environment mutation was made.
- [x] No freshness-only Production Auth Smoke was requested or executed.
- [x] No image generation or image editing was used.
- [x] Evidence is explicitly classified as exact-current, current-by-scope, or scope-limited instead of being silently stretched across later changes.

## Release conclusion

**Technical/operational beta posture: GO.**

This GO does not erase the pending qualified-counsel review and does not convert scope-limited historical Production evidence into exact-current execution. Any material change after current main `69ed457c8a057fdb9fe69d05c03b078d164b370c` must be compared against the relevant proof before this checklist is reused.
