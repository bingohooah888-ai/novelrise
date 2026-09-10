# NOVELIGHT public-beta release checklist

This checklist is the final operational gate after code review/CI. A checked box must represent an observed result or a specifically justified still-valid result under `docs/EVIDENCE-FRESHNESS-GATE.md`, not an assumption.

**Reconciled: 2026-09-10 JST.**

Historical controlled public-beta GO remains recorded in `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Current material launch main at reconciliation: `a505814b1a16c8b30d5731ed5db602f2c032d026`.

**CURRENT LAUNCH POSTURE: BLOCKED — approved official thumbnail assets are not yet populated in Production. A fresh Production Authenticated Smoke is required after that prerequisite is satisfied.**

Qualified Japanese counsel review remains deferred/pending. The owner residual-risk decision is recorded in `docs/legal-beta-review.md`; this checklist does not assert legal sufficiency.

## Git / CI

- [x] Latest `main` and authoritative release/evidence rules were re-fetched before reconciliation.
- [x] PR #475 head `2b45ee4f89f8cc216f63979ef6941e279e8978db` passed `NOVELIGHT CI` #2006 / run `34459125776` before squash merge.
- [x] PR #475 Merge readiness, aggregate `check`, Node tests, static quality, desktop/mobile smoke, and desktop/mobile async-UI browser jobs passed.
- [x] Desktop + mobile Playwright gates pass on the current code-equivalent PR #475 evidence above.
- [x] PR #475 head `CodeQL` #1918 / run `34459125775` completed `success`.
- [x] Exact-current Vercel Production commit status on main `a505814b1a16c8b30d5731ed5db602f2c032d026` is `success`.
- [x] No selectively skipped job is represented as executed.

## Official thumbnail launch dependency

- [x] Official-thumbnail schema and privilege hardening remain part of Production state.
- [x] Read-only Production inspection confirmed `public.novel_thumbnail_assets` exists and the posting UI's read boundary is intact.
- [x] Read-only Production inspection confirmed 0 total catalog rows, 0 active rows, and 0 `novel-thumbnails` Storage objects.
- [x] PR #475 makes `active_official_thumbnails_present=false` a deterministic Production Readiness failure.
- [x] The empty catalog is treated as a known content-preparation dependency, not silently relabeled as a successful posting path.
- [ ] An approved official thumbnail set has been prepared.
- [ ] Under separate explicit Production authorization, approved official thumbnail assets have been uploaded/cataloged through the existing ADMIN path.
- [ ] Production Readiness confirms `active_official_thumbnails_present=true` and all other deterministic integrity checks pass after asset population.

Do not upload a placeholder logo or synthetic test image to Production merely to make the smoke pass.

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
- [ ] Changed Chapter 38 authenticated Production behavior has a fresh successful approval-gated Production Authenticated Smoke after the material Chapter 38 changes and after official thumbnails are available.

## Final authenticated smoke

Newest successful Production authenticated proof remains historical for the changed Chapter 38 scope:

- Issue: `#393`.
- Run: `34025686074` (#520).
- Exact approved/head main: `5a5b502c61d984bf7d0329ea59a8d99b55b05861`.
- Decisive authenticated verification: `success`.
- Approval ledger: OWNER approval -> `CLAIMED` -> `CONSUMED`, `result="success"`.
- Ephemeral smoke data and cleanup: `success`.
- No Stripe live charge created.

Fresh failed attempt #1:

- [x] Issue #472 received exact OWNER approval for main `8d618f243f97057c1f4202c20b6f873cd12e5244`.
- [x] Run `34453321240` was `CLAIMED` and the browser verification actually executed.
- [x] Browser verification failed; it is not counted as PASS.
- [x] Ephemeral Production smoke-data cleanup succeeded.
- [x] Temporary Production credential / fixture cleanup succeeded.
- [x] The failed request was recorded and closed rather than reused.
- [x] PR #473 corrected the stale smoke assumptions exposed by this run.

Fresh failed attempt #2:

- [x] Issue #474 received exact OWNER approval for main `ce1442bc325e309be23c50767af5585c2f27ea16`.
- [x] Run `34456994468` was `CLAIMED` and the browser verification actually executed.
- [x] Browser verification failed; it is not counted as PASS.
- [x] Ephemeral Production smoke-data cleanup succeeded.
- [x] Temporary Production credential / fixture cleanup succeeded.
- [x] The failed request was recorded and closed rather than reused.
- [x] The posting failure exposed the empty official-thumbnail prerequisite; the author-profile failure exposed a stale `#profileBioSummary` smoke selector.
- [x] PR #475 corrected the author-profile selector and added the empty-thumbnail Production Readiness blocker without inventing thumbnail content.

Next successful-smoke gate:

- [ ] Official thumbnail preparation and Production population gates above are satisfied first.
- [ ] A current or backend-equivalent non-expired Production Auth Smoke request receives explicit OWNER approval.
- [ ] Its decisive `Verify authenticated beta-critical production flows` job completes `success`.
- [ ] Cleanup completes and a matching `CONSUMED result="success"` is recorded.

## Discovery / LIGHT ANALYTICS / posting / author home

- [x] Existing Free/Standard/Premium discovery and LIGHT ANALYTICS behavior remains covered by prior still-valid evidence where unchanged.
- [x] Trusted allocation receipts and server-authoritative PV counting remain part of Production state.
- [x] Official thumbnail schema/privilege hardening remains part of Production state.
- [x] Author-home public profile/avatar/recent-activity boundary remains part of Production state.
- [x] Current repository CI covers reader/author UI regressions.
- [ ] Production has at least one approved active official thumbnail so new novel submission can complete.
- [ ] Changed authenticated Chapter 38 reader/engagement paths are promoted to current successful Production Auth Smoke evidence.

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
- [x] No reviewed change modifies the backup/restore control boundary.
- [x] Production restore is not repeated for documentary freshness.

## Beta pricing / Production billing

- [x] Standard beta pricing remains `0円` without required credit-card registration.
- [x] Premium beta special pricing remains `月額480円`.
- [x] Premium regular/formal price remains `月額1,980円`.
- [x] `NOVELIGHT Stripe Production Bootstrap` #7 / run `33612120034` remains the decisive live billing proof.
- [x] No later Chapter 38 / PR #473 / PR #475 change alters Stripe pricing, billing routes, entitlement pricing, Stripe Secrets, or Vercel billing configuration.
- [x] Stripe live operations are not repeated solely for documentary freshness.

## Legal / brand / public surfaces

- [x] Terms, privacy, content guidelines, billing policy, commerce disclosure and contact remain public release surfaces.
- [x] Current repository CI/CodeQL evidence and exact-current Vercel Production deployment status pass.
- [ ] Qualified Japanese counsel review is complete. **Deferred/pending by owner; accepted residual risk remains recorded.**

## Final release gate

- [x] Current material main is `a505814b1a16c8b30d5731ed5db602f2c032d026` at this reconciliation.
- [x] Production migration ledger, billing, backup, and unchanged operational boundaries have supportable current/still-valid evidence.
- [x] Failed Production Auth Smoke attempts #472 and #474 are recorded as failures with successful cleanup rather than silently promoted to PASS.
- [x] Empty official-thumbnail availability now fails Production Readiness deterministically.
- [ ] Approved official thumbnail assets are prepared and populated in Production.
- [ ] Production Readiness passes after thumbnail population.
- [ ] Fresh approval-gated Production Authenticated Smoke proves the materially changed authenticated Production boundary.

**Release posture until the remaining thumbnail/readiness/Auth Smoke gates are satisfied: BLOCKED.**

After an approved official thumbnail set is populated, run Production Readiness first. Only after readiness passes should a new Production Authenticated Smoke be approved and executed. Once that smoke has decisive job success, cleanup success, and `CONSUMED result="success"`, reconcile this checklist and `docs/BETA-RELEASE-EVIDENCE-LATEST.md` again before changing CURRENT LAUNCH POSTURE back to GO.
