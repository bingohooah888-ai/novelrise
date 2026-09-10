# NOVELIGHT public-beta release checklist

This checklist is the final operational gate after code review/CI. A checked box must represent an observed result or a specifically justified still-valid result under `docs/EVIDENCE-FRESHNESS-GATE.md`, not an assumption.

**Reconciled: 2026-09-10 JST.**

Historical controlled public-beta GO remains recorded in `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Current material launch main at reconciliation: `f9dc927ca8a913b7f57ed484462369df2db35eec`.

**CURRENT LAUNCH POSTURE: CONDITIONAL — fresh Production Authenticated Smoke required for the changed Chapter 38 authenticated boundary.**

Qualified Japanese counsel review remains deferred/pending. The owner residual-risk decision is recorded in `docs/legal-beta-review.md`; this checklist does not assert legal sufficiency.

## Git / CI

- [x] Latest `main` and authoritative release/evidence rules were re-fetched before reconciliation.
- [x] Exact-current `NOVELIGHT CI` #1994 / run `34449826475` completed `success` on `f9dc927ca8a913b7f57ed484462369df2db35eec`.
- [x] Exact-current aggregate `check`, Node tests, static quality, desktop/mobile smoke, and desktop/mobile async-UI browser jobs passed.
- [x] Desktop + mobile Playwright gates pass on the exact-current CI evidence above.
- [x] Exact-current `CodeQL` #1907 / run `34449826661` completed `success`.
- [x] Exact-current Vercel Production commit status is `success`.
- [x] `NOVELIGHT Production Readiness Smoke` #109 / run `34449301741` passed on prior main `465489e5151d7a1c697557394cb792a4aa78cbd9`.
- [x] Production Readiness #109 remains valid for the current read-only boundary because PR #470 only removed SCOUT EXP disclosure/style and updated tests; it did not change routes, APIs, auth, DB, billing, or environment configuration.
- [x] No selectively skipped job is represented as executed.

## Supabase Production

Previously reconciled Production migrations through `20260906120000_author_profile_avatar_and_activity.sql` remain part of current Production state.

Chapter 38 Production state:

- [x] `20260909071500_scout_beta_event_foundations.sql` and `20260909071510_scout_beta_rules_rls.sql` are covered by issue #165 / bridge run `34315738396`, mutation/postcheck `success`.
- [x] `20260909080000_disable_light_seed_v1_client_rpcs.sql` was applied during the Chapter 38 Production rollout and is not repeated for documentary freshness.
- [x] `20260909100000_chapter38_work_rank_engine.sql` was applied during the Chapter 38 Production rollout and is not repeated for documentary freshness.
- [x] `20260909120000_chapter38_work_rank_lifecycle.sql` is covered by issue #165 / bridge run `34335400168`, mutation/postcheck `success`.
- [x] `20260909130000_chapter38_rank_bayesian_percentiles.sql` is covered by issue #165 / bridge run `34340585331`, mutation/postcheck `success`.
- [x] `20260909140000_chapter38_seed_discovery_exp.sql` is covered by issue #165 / bridge run `34358566221`, mutation/postcheck `success`.
- [x] `20260909190000_chapter38_star_rating_scout_exp.sql` is covered by issue #460 / bridge run `34408554615`, `result="success"`, mutation/postcheck `success`.
- [x] `20260910070000_chapter38_comment_scout_exp_foundation.sql` is covered by issue #460 / bridge run `34413902759`, mutation/postcheck `success`.
- [x] `20260910143000_chapter38_exclude_self_comment_scout_exp.sql` is covered by issue #460 / bridge run `34441780108`, `result="success"`, mutation/postcheck `success`.
- [x] No Production migration is being repeated merely to refresh this checklist.

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
- [ ] Changed Chapter 38 authenticated Production behavior has a fresh successful approval-gated Production Authenticated Smoke after the material Chapter 38 changes.

## Final authenticated smoke

Newest confirmed successful Production authenticated proof remains historical for the changed Chapter 38 scope:

- Issue: `#393`.
- Run: `34025686074` (#520).
- Exact approved/head main: `5a5b502c61d984bf7d0329ea59a8d99b55b05861`.
- Decisive authenticated verification: `success`.
- Approval ledger: OWNER approval -> `CLAIMED` -> `CONSUMED`, `result="success"`.
- Ephemeral smoke data and cleanup: `success`.
- No Stripe live charge created.

Freshness classification:

- [x] #393 remains valid historical evidence for boundaries unchanged since that SHA.
- [x] #393 is no longer labeled exact-current for the later Chapter 38 authenticated/database boundary.
- [x] Newer request-only runs are not counted as authenticated smoke PASS.
- [x] Issue #469 for `465489e5...` contains a request but no OWNER approval/CLAIMED/CONSUMED evidence.
- [ ] A current or backend-equivalent non-expired request receives explicit OWNER approval.
- [ ] Its decisive `Verify authenticated beta-critical production flows` job completes `success`.
- [ ] Cleanup completes and a matching `CONSUMED result="success"` is recorded.

## Discovery / LIGHT ANALYTICS / posting / author home

- [x] Existing Free/Standard/Premium discovery and LIGHT ANALYTICS behavior remains covered by prior still-valid evidence where unchanged.
- [x] Trusted allocation receipts and server-authoritative PV counting remain part of Production state.
- [x] Official thumbnail schema/privilege hardening remains part of Production state.
- [x] Author-home public profile/avatar/recent-activity boundary remains part of Production state.
- [x] Exact-current CI covers current reader/author UI regressions.
- [ ] Changed authenticated Chapter 38 reader/engagement paths are promoted to current Production Auth Smoke evidence.

## Content / moderation / ADMIN

- [x] AI-use classification and mature-content warning requirements remain in place.
- [x] Report submission/privacy and operator workflow remain covered by prior current/still-valid evidence.
- [x] ADMIN remains server-side authenticated/allowlisted and read-only under the existing boundary.
- [x] Chapter 38 ADMIN beta analytics has current repository coverage.
- [x] Production Auth Smoke is not used to claim the ADMIN authorization boundary.

## Backup / restore — hard GO gate

- [x] Production Supabase scheduled-backup posture remains established.
- [x] `NOVELIGHT Production Backup Freshness` #8 / run `33354249864` remains the newest accepted read-only backup freshness proof.
- [x] Non-Production restore rehearsal remains recorded.
- [x] No reviewed change modifies the backup/restore control boundary.
- [x] Production restore is not repeated for documentary freshness.

## Beta pricing / Production billing

- [x] Standard beta pricing remains `0円` without required credit-card registration.
- [x] Premium beta special pricing remains `月額480円`.
- [x] Premium regular/formal price remains `月額1,980円`.
- [x] `NOVELIGHT Stripe Production Bootstrap` #7 / run `33612120034` remains the decisive live billing proof.
- [x] No later Chapter 38 / PR #468 / PR #470 change alters Stripe pricing, billing routes, entitlement pricing, Stripe Secrets, or Vercel billing configuration.
- [x] Stripe live operations are not repeated solely for documentary freshness.

## Legal / brand / public surfaces

- [x] Terms, privacy, content guidelines, billing policy, commerce disclosure and contact remain public release surfaces.
- [x] Exact-current CI/CodeQL/Vercel pass.
- [x] Latest relevant Production Readiness #109 passes and remains valid by the narrow PR #470 equivalence documented in `docs/BETA-RELEASE-EVIDENCE-LATEST.md`.
- [ ] Qualified Japanese counsel review is complete. **Deferred/pending by owner; accepted residual risk remains recorded.**

## Final release gate

- [x] Current material main is `f9dc927ca8a913b7f57ed484462369df2db35eec` at this reconciliation.
- [x] Repository CI, CodeQL, Vercel Production, read-only Production readiness, Production migration ledger, billing, backup, and unchanged operational boundaries have supportable current/still-valid evidence.
- [x] The previous exact-current wording around Production Auth Smoke #393 has been removed rather than silently carried forward.
- [ ] Fresh approval-gated Production Authenticated Smoke proves the materially changed Chapter 38 authenticated Production boundary.

**Release posture until the final unchecked Auth Smoke gate is satisfied: CONDITIONAL.**

Once a successful fresh smoke has a matching OWNER approval, decisive job success, cleanup success, and `CONSUMED result="success"`, reconcile this checklist and `docs/BETA-RELEASE-EVIDENCE-LATEST.md` again before changing CURRENT LAUNCH POSTURE back to GO.
