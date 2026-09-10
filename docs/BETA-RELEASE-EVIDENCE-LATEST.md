# NOVELIGHT β Release Evidence — Latest Reconciled State

**Reconciled: 2026-09-10 JST**

This file is the rolling current-state index required by `docs/EVIDENCE-FRESHNESS-GATE.md`. Dated `BETA-RELEASE-EVIDENCE-*.md` files remain historical snapshots and are not rewritten. Older proof is reused only when the current scope is demonstrated to be unchanged or materially equivalent.

## Release decision

**Historical controlled public-beta GO: RECORDED 2026-08-28.**

**Current launch posture: CONDITIONAL — fresh Production Authenticated Smoke required before relying on the changed authenticated Chapter 38 boundary for release.**

Decision record: `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Historical decision baseline main: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1`.

Current material launch main at this reconciliation: `f9dc927ca8a913b7f57ed484462369df2db35eec` (`Hide Chapter 38 SCOUT EXP from beta comment UI (#470)`).

This conditional posture is an evidence-freshness condition, not a confirmed product defect. Since the last successful Production Authenticated Smoke, Chapter 38 materially changed authenticated reader/engagement and database behavior, including valid-read tracking, LIGHT SEED v2/SCOUT event foundations, Work Rank, star-rating EXP, comment EXP, and related replayable ledgers. Those changed boundaries must not inherit the old exact-current label.

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING** with owner residual risk recorded in `docs/legal-beta-review.md`. This is an operational release posture, not a finding of legal sufficiency.

## Freshness decision table

| Scope | Newest decisive proof | Freshness on `f9dc927c...` | Status |
| --- | --- | --- | --- |
| Repository CI / browser regression | CI #1994 / run `34449826475` on exact current main | exact-current | PASS |
| CodeQL | #1907 / run `34449826661` on exact current main | exact-current | PASS |
| Vercel Production deployment | commit status on exact current main | exact-current | PASS |
| Public/read-only Production surfaces | Production Readiness #109 / run `34449301741` on `465489e5...` | still-valid by narrow equivalence: #470 only removed user-facing SCOUT EXP copy/style and updated tests; no route, API, auth, DB, billing, or environment boundary changed | PASS |
| Supabase Production migrations | approval-ledger executions/postchecks through `20260910143000` | current Production state | PASS |
| Production authenticated beta-critical flows | Issue #393 / run `34025686074` on `5a5b502c...` | stale for later material Chapter 38 authenticated/database changes | REFRESH REQUIRED |
| Stripe/billing | Stripe Production Bootstrap #7 / run `33612120034` | still-valid; no later pricing/billing contract change in this reconciliation | PASS |
| Backup/restore | Production Backup Freshness #8 / run `33354249864` plus recorded non-Production restore rehearsal | still-valid; no backup-control change | PASS |
| Legal counsel | owner-deferred | unchanged | PENDING / ACCEPTED RESIDUAL RISK |

## Git / CI — PASS / EXACT CURRENT MAIN

Exact current-main evidence for `f9dc927ca8a913b7f57ed484462369df2db35eec`:

- `NOVELIGHT CI` #1994 / run `34449826475`: `success`.
- Required aggregate `check`: `success`.
- Node tests and static quality: `success`.
- Desktop/mobile smoke browser jobs: `success`.
- Desktop/mobile async-UI browser jobs: `success`.
- `CodeQL` #1907 / run `34449826661`: `success`.
- Vercel commit status: `success`.

The newest relevant read-only Production proof is `NOVELIGHT Production Readiness Smoke` #109 / run `34449301741` on main `465489e5151d7a1c697557394cb792a4aa78cbd9`. Its decisive job `Verify deployed public surfaces and production observability` completed `success`, including static-route checks, safe API route contracts, read-only Production reader smoke, and observability verification.

PR #470 moved main from `465489e5...` to `f9dc927c...` but changed only the beta comment UI disclosure/style and its regression test. It removed the user-visible `SCOUT EXP` note without changing comment RPCs, authorization, SCOUT EXP calculation, Work Rank behavior, database schema, billing, or environment configuration. Under the Evidence Freshness Gate, Production Readiness #109 therefore remains usable for that unchanged read-only boundary; exact-current CI/CodeQL/Vercel cover the #470 delta.

## Supabase Production — PASS / CURRENT VIA APPROVAL LEDGER

Previously reconciled Production migrations through `20260906120000_author_profile_avatar_and_activity.sql` remain historical/current state and are not rerun for documentary freshness.

Chapter 38 added material Production state after the 2026-09-06 evidence snapshot. Confirmed approval-ledger executions include:

- foundation batch containing `20260909071500_scout_beta_event_foundations.sql` and `20260909071510_scout_beta_rules_rls.sql`:
  - ledger issue `#165`;
  - approved main `7e7b657048c4c13ec9a9185182c83dd93839d4dc`;
  - bridge run `34315738396`;
  - `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`.
- `20260909080000_disable_light_seed_v1_client_rpcs.sql` and `20260909100000_chapter38_work_rank_engine.sql` were applied during the Chapter 38 Production rollout before the later lifecycle/rank migrations; prior deployment precheck/postcheck evidence remains part of that rollout history and is not re-executed here.
- `20260909120000_chapter38_work_rank_lifecycle.sql`:
  - ledger issue `#165`;
  - approved main `e6de1ec2ec0366f5ca22511f771f0e6a1bbe0371`;
  - bridge run `34335400168`;
  - mutation/postcheck `success`.
- `20260909130000_chapter38_rank_bayesian_percentiles.sql`:
  - ledger issue `#165`;
  - approved main `cb9e753595254763c9176f5909343d2d27b1c451`;
  - bridge run `34340585331`;
  - mutation/postcheck `success`.
- `20260909140000_chapter38_seed_discovery_exp.sql`:
  - ledger issue `#165`;
  - approved main `d34be989cd3c55b3679420a4ec605c35e377f9f9`;
  - bridge run `34358566221`;
  - mutation/postcheck `success`.
- `20260909190000_chapter38_star_rating_scout_exp.sql`:
  - active ledger issue `#460`;
  - approved main `5f773101bf6c0f05cdf8b043363b184b34d896bf`;
  - bridge run `34408554615`;
  - `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`.
- `20260910070000_chapter38_comment_scout_exp_foundation.sql`:
  - issue `#460`;
  - approved main `824fdfb5e2f466b0f26623de94cc834fcfb7a717`;
  - bridge run `34413902759`;
  - mutation/postcheck `success`.
- `20260910143000_chapter38_exclude_self_comment_scout_exp.sql`:
  - issue `#460`;
  - approved main `da1b8bd765e3b79cce56ea17fa05d6dd8d81795b`;
  - bridge run `34441780108`;
  - `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`.

No Production migration is executed by this documentary reconciliation.

## Chapter 38 product boundary — IMPLEMENTED / AUTH PROOF REFRESH REQUIRED

Current code and Production migration state contain the beta foundations required by MASTER Chapter 38, including:

- replayable SCOUT event and EXP ledgers;
- valid-read sessions/events and anti-duplication rules;
- reader heartbeat/progress signaling from the episode reader;
- LIGHT SEED event attribution and send-time Rank capture;
- Work Rank calculation/history lifecycle and Bayesian/percentile logic;
- 180-day LIGHT SEED discovery EXP;
- star-rating SCOUT EXP;
- comment SCOUT EXP with self-comment exclusion;
- ADMIN beta analysis support;
- beta UI hiding SCOUT Level, Rank, badges, EXP, and unreleased SCOUT RECORD mechanics while keeping LIGHT SEED send history separate.

This section records implementation/deployment state. It does **not** substitute for a fresh approval-gated Production Authenticated Smoke of the changed authenticated behavior.

## Production authenticated beta-critical path — REFRESH REQUIRED

Newest confirmed successful Production authenticated proof remains:

- request issue `#393`;
- workflow `NOVELIGHT Production Auth Smoke Approval Handler`;
- run `34025686074` (#520);
- exact approved/head SHA `5a5b502c61d984bf7d0329ea59a8d99b55b05861`;
- decisive authenticated verification job: `success`;
- approval ledger: exact OWNER approval -> `CLAIMED` -> `CONSUMED`, `result="success"`;
- ephemeral Production smoke users/data and cleanup: `success`;
- no Stripe live charge created by the smoke.

This proof remains valid for unchanged historical boundaries but is **not current proof for the later Chapter 38 authenticated/database changes**.

Newer request issues were created, including Issue #469 for main `465489e5151d7a1c697557394cb792a4aa78cbd9`, but Issue #469 has no OWNER approval/CLAIMED/CONSUMED record. Request creation is not authenticated-smoke PASS evidence.

Required release-proof action:

1. create or use a non-expired Production Auth Smoke request whose approved main is current or demonstrated backend-equivalent to current main;
2. obtain explicit OWNER approval through the repository's approval contract;
3. require the decisive authenticated verification job to execute and pass;
4. require cleanup and matching `CONSUMED result="success"` evidence;
5. only then restore this scope to PASS/current and return current launch posture from CONDITIONAL to GO.

Do not relabel an unapproved request workflow as a successful smoke.

## Production billing / Stripe / entitlement — PASS / STILL VALID

The beta billing contract remains:

- Standard: beta period `0円`, credit card not required;
- Premium: beta special price `月額480円`;
- Premium regular/formal price: `月額1,980円`.

Decisive live billing proof remains `NOVELIGHT Stripe Production Bootstrap` #7 / run `33612120034` on `3ad58fc878ac5ce7880ee2e55d946ffbe8a8fbfe`, conclusion `success`.

No Chapter 38, PR #468, or PR #470 change reviewed in this reconciliation alters Stripe pricing, checkout/billing route semantics, entitlement pricing, Stripe Secrets, or Vercel billing configuration. Live billing operations are therefore not repeated merely to refresh documentation.

## Backup / restore — PASS / STILL VALID

Newest accepted read-only backup evidence remains `NOVELIGHT Production Backup Freshness` #8 / run `33354249864`, conclusion `success`, together with the previously recorded non-Production restore rehearsal and `docs/BACKUP-RESTORE-RUNBOOK.md`.

No change reviewed here modifies the backup/restore control boundary. No Production restore or backup mutation is repeated.

## Content / moderation / ADMIN — PASS WITH SCOPE LIMIT

Previously established content classification/warning/report privacy and ADMIN allowlist controls remain in force. Chapter 38 ADMIN beta analytics has current repository CI/CodeQL coverage, but Production Auth Smoke is not used to claim the ADMIN authorization boundary.

## Legal / brand status

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING**. The recorded owner residual-risk decision remains historical and explicit. Nothing in this evidence file asserts legal sufficiency.

## Checklist reconciliation

`docs/BETA-RELEASE-CHECKLIST.md` is reconciled in parallel with this rolling index.

An `[x]` means current or specifically justified still-valid evidence exists. An `[ ]` means proof is missing/stale or a manual/external gate is still open. A stale proof is not converted into PASS merely because current CI is green.

## Current release state

**Controlled public-beta historical GO remains recorded, but CURRENT LAUNCH POSTURE is CONDITIONAL as of 2026-09-10.**

Current material main: `f9dc927ca8a913b7f57ed484462369df2db35eec`.

Exact-current CI #1994 / `34449826475`, CodeQL #1907 / `34449826661`, and Vercel Production status are successful. Latest relevant Production Readiness #109 / `34449301741` is successful and remains valid for the current read-only boundary by the narrow #470 equivalence described above. Chapter 38 Production migrations are reconciled through successful approval-ledger execution/postchecks.

**Only the changed authenticated Chapter 38 Production boundary is release-proof incomplete. A fresh approval-gated Production Authenticated Smoke is required before restoring CURRENT LAUNCH POSTURE to GO.**
