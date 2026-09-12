# NOVELIGHT β Release Evidence — Latest Reconciled State

**Reconciled: 2026-09-12 JST**

This file is the rolling current-state index required by `docs/EVIDENCE-FRESHNESS-GATE.md`. Dated `BETA-RELEASE-EVIDENCE-*.md` files remain historical snapshots and are not rewritten. Older proof is reused only when the current scope is demonstrated to be unchanged or materially equivalent.

## Release decision

**Historical controlled public-beta GO: RECORDED 2026-08-28.**

**Current launch posture: GO — the official-thumbnail, Production Readiness, and fresh authenticated Production-smoke blockers recorded on 2026-09-10 are now cleared on exact current main.**

Decision record: `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Historical decision baseline main: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1`.

Current material launch main at this reconciliation: `e4e8673d6b45b046c69672a8e5fe72011c1a0081` (`Activate beta Standard before Production analytics smoke (#510)`).

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING** with owner residual risk recorded in `docs/legal-beta-review.md`. This is an operational release posture, not a finding of legal sufficiency.

## Why the 2026-09-10 BLOCKED snapshot is no longer current

The prior rolling evidence correctly recorded three technical blockers:

1. no active official thumbnail in Production;
2. Production Readiness had not yet passed after official-thumbnail population;
3. no fresh successful approval-gated Production Authenticated Smoke existed for the changed beta-critical flow.

Those statements were historical snapshots. Under `docs/EVIDENCE-FRESHNESS-GATE.md`, newer specific successful execution evidence supersedes them when no later material change invalidates the proof.

As of this reconciliation:

- exact current main remains `e4e8673d6b45b046c69672a8e5fe72011c1a0081`;
- exact-current Vercel Production deployment status is `success`;
- exact-current `production-readiness-smoke` is `success` after official-thumbnail population;
- the readiness SQL includes `active_official_thumbnails_present` in the deterministic integrity verdict, so the successful readiness result proves that the old empty-catalog blocker is no longer current;
- dedicated Production Auth Smoke issue #511 received OWNER approval for exact current main;
- approval-handler run `34692176490` is an `issue_comment` run of `NOVELIGHT Production Auth Smoke Approval Handler`, conclusion `success`;
- its single decisive `Verify authenticated beta-critical production flows` job completed `success`;
- #511 contains one matching GitHub-Actions-authored `NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED` record binding the request ID, exact main SHA, run `34692176490`, and `result="success"`;
- cleanup completed and #511 was closed;
- no later main commit exists at reconciliation time to invalidate that exact-current proof.

Therefore the prior BLOCKED posture must not be used to justify duplicate Production population, readiness, migration, or Auth Smoke work.

## Freshness decision table

| Scope | Newest decisive proof | Freshness on current launch main | Status |
| --- | --- | --- | --- |
| Repository CI / browser regression | exact-current main checks for `e4e8673d...` | exact-current | PASS |
| CodeQL | exact-current CodeQL on `e4e8673d...` | exact-current | PASS |
| Vercel Production deployment | commit status on `e4e8673d...` | exact-current | PASS |
| Official thumbnail availability | exact-current Production Readiness | `active_official_thumbnails_present=true` is required by the successful integrity verdict | PASS |
| Production Readiness | `production-readiness-smoke` on `e4e8673d...` | exact-current | PASS |
| Supabase Production migrations | reconciled Chapter 38 ledger plus already-applied `20260911123000_fix_thumbnail_asset_registration_path.sql` | current Production state; no rerun required | PASS |
| Production authenticated beta-critical flows | Issue #511 / run `34692176490` | exact-current approval-handler execution plus matching consumed ledger | PASS |
| Chapter 40 geometry thumbnail flow | same exact-current authenticated smoke | create/render/composition persistence exercised in Production-authenticated flow | PASS |
| LIGHT ANALYTICS | same exact-current authenticated smoke | exact-current | PASS |
| Stripe/billing | Stripe Production Bootstrap #7 / run `33612120034` | still-valid; no reviewed Chapter 40/smoke fix requires a live billing repeat | PASS |
| Backup/restore | Production Backup Freshness #8 / run `33354249864` plus recorded non-Production restore rehearsal | still-valid; no backup-control change | PASS |
| Legal counsel | owner-deferred | unchanged | PENDING / ACCEPTED RESIDUAL RISK |

## Git / CI — PASS

Current main is `e4e8673d6b45b046c69672a8e5fe72011c1a0081`.

Fresh exact-current GitHub evidence shows the required repository quality gates passing, including:

- aggregate NOVELIGHT CI / `check`;
- Node tests;
- static quality;
- desktop browser smoke;
- mobile browser smoke;
- desktop async-UI browser coverage;
- mobile async-UI browser coverage;
- CodeQL;
- Vercel Production deployment status;
- Production Readiness.

Skipped deployment/mutation jobs are not represented as executed.

## Official thumbnail launch dependency — PASS

The official-thumbnail schema and privilege hardening remain part of Production state.

The historical 2026-09-10 inspection found 0 official-thumbnail rows and correctly blocked the release. That state has since changed through the authorized Chapter 40 workstream.

Current decisive evidence is the successful exact-current Production Readiness result. `supabase/checks/production_beta_observability.sql` requires `active_official_thumbnails_present` as part of the final integrity verdict, based on an active row in `public.novel_thumbnail_assets`. The successful readiness status therefore establishes that the launch prerequisite is no longer empty.

The subsequent exact-current authenticated Production smoke exercised new-novel creation and Chapter 40 thumbnail behavior, so the posting path is no longer supported only by catalog-existence evidence.

Do not repeat asset registration or introduce placeholder content merely to refresh documentation.

## Supabase Production — PASS / CURRENT

Previously reconciled Production migrations through `20260910143000_chapter38_exclude_self_comment_scout_exp.sql` remain current state and are not rerun for documentary freshness.

Chapter 38 approval-ledger history remains recorded in earlier release evidence and the release checklist, including the foundation, lifecycle/rank, discovery, star-rating, comment, and self-comment-exclusion migrations.

Chapter 40 / official-thumbnail registration adds the following current state:

- PR #490 (`Fix official thumbnail asset registration path validation`) merged the hotfix migration `20260911123000_fix_thumbnail_asset_registration_path.sql`;
- the migration fixes the canonical official-thumbnail Storage-path validation in `novelight_admin_register_thumbnail_layer_asset` while preserving the service-role/SECURITY DEFINER boundary;
- `20260911123000_fix_thumbnail_asset_registration_path.sql` has already been applied in Production during the completed Chapter 40 workstream;
- this reconciliation performs no Production migration and the already-applied migration must not be rerun.

The successful exact-current readiness and authenticated smoke are later current-state evidence that the affected official-thumbnail path is operational.

## Chapter 38 product boundary — IMPLEMENTED / CURRENT AUTH PROOF PASS

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

Unlike the 2026-09-10 snapshot, this materially changed authenticated boundary now has a fresh exact-current successful Production Authenticated Smoke: Issue #511 / run `34692176490`.

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

Relevant implementation/proof chain after the prior blocked snapshot includes:

- PR #490: fixes official-thumbnail asset registration path validation;
- PR #497: captures thumbnail render response bodies inside the response wait so the smoke can prove the render response reliably;
- PR #508: fixes the Production Auth Smoke LIGHT ANALYTICS heading selector;
- PR #510: activates beta Standard before the Production analytics smoke and produces current main `e4e8673d...`.

The fresh authenticated Production flow verifies novel creation, Chapter 40 thumbnail render, composition persistence, and LIGHT ANALYTICS. Render-output storage cleanup and ephemeral smoke-data cleanup completed after verification.

## Production authenticated beta-critical path — PASS

Current decisive request and execution:

- dedicated request issue: #511;
- request ID: `auth-smoke-e4e8673d6b45b046c69672a8e5fe72011c1a0081-34691803431`;
- approved main: `e4e8673d6b45b046c69672a8e5fe72011c1a0081`;
- approval author association: OWNER;
- approval-handler run: `34692176490`;
- workflow: `NOVELIGHT Production Auth Smoke Approval Handler`;
- trigger event: `issue_comment`;
- workflow conclusion: `success`;
- decisive job `Verify authenticated beta-critical production flows`: exactly one, `success`;
- desktop/mobile authenticated smoke: pass;
- LIGHT ANALYTICS: pass;
- cleanup: pass;
- matching GitHub-Actions-authored consumed ledger record: exactly one, `result="success"`, same request ID, same run ID, same exact main SHA;
- issue #511: closed after consumption;
- Stripe live charge: none.

This evidence set matches the acceptance contract in `scripts/evaluate-production-auth-smoke-evidence.mjs`: expected workflow/event, top-level success, one successful decisive job, exact required head SHA, and one matching successful consumed record.

Historical attempts #472 and #474 remain failures with successful cleanup. They are retained for audit and are not relabeled. Their older failed status no longer overrides the newer exact-current successful proof.

## LIGHT ANALYTICS / discovery / posting / author home — PASS

Current evidence supports the beta-critical user path:

- active official-thumbnail availability is present;
- new-novel submission completes in the authenticated Production smoke;
- Chapter 40 rendering/persistence completes;
- LIGHT ANALYTICS passes after the PR #510 beta Standard entitlement activation;
- existing discovery, trusted allocation receipt, server-authoritative PV, author-profile/avatar/recent-activity boundaries remain covered by current or specifically still-valid evidence;
- current repository CI covers reader/author UI regression scope.

## Production billing / Stripe / entitlement — PASS / STILL VALID

The beta billing contract remains:

- Standard: beta period `0円`, credit card not required;
- Premium: beta special price `月額480円`;
- Premium regular/formal price: `月額1,980円`.

Decisive live billing proof remains `NOVELIGHT Stripe Production Bootstrap` #7 / run `33612120034`, conclusion `success`.

PRs #490, #497, #508, and #510 do not create a reason to repeat a Stripe live operation for documentary freshness. The successful Production Auth Smoke created no real Stripe charge.

## Backup / restore — PASS / STILL VALID

Newest accepted read-only backup evidence remains `NOVELIGHT Production Backup Freshness` #8 / run `33354249864`, conclusion `success`, together with the previously recorded non-Production restore rehearsal and `docs/BACKUP-RESTORE-RUNBOOK.md`.

No reviewed Chapter 40 or smoke-fix change modifies the backup/restore control boundary. No Production restore or backup mutation is repeated.

## Content / moderation / ADMIN — PASS WITH SCOPE LIMIT

Previously established content classification/warning/report privacy and ADMIN allowlist controls remain in force. Chapter 38 ADMIN beta analytics has repository CI/CodeQL coverage, but Production Auth Smoke is not used to claim the ADMIN authorization boundary.

## Legal / brand status

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING**. The recorded owner residual-risk decision remains historical and explicit. Nothing in this evidence file asserts legal sufficiency.

## Checklist reconciliation

`docs/BETA-RELEASE-CHECKLIST.md` is reconciled in parallel with this rolling index.

An `[x]` means current or specifically justified still-valid evidence exists. An `[ ]` means proof is missing/stale or a manual/external gate is still open. Historical failed proof remains failed; it is superseded for current-state classification only by newer evidence for the same scope.

## Current release state

**CURRENT LAUNCH POSTURE: GO as of 2026-09-12 reconciliation.**

Current material main: `e4e8673d6b45b046c69672a8e5fe72011c1a0081`.

The former release blockers are now resolved in the required order: official-thumbnail availability is present, exact-current Production Readiness passes, and a fresh exact-current approval-gated Production Authenticated Smoke passes with successful cleanup and matching consumed-approval evidence.

No duplicate Production operation is needed to support this release-state conclusion. In particular, do not rerun `20260911123000_fix_thumbnail_asset_registration_path.sql`, do not repopulate official assets merely for documentary freshness, and do not repeat Auth Smoke/Stripe/Secret operations unless a later material change makes the existing proof `refresh-required` under `docs/EVIDENCE-FRESHNESS-GATE.md`.

The remaining qualified Japanese counsel review is still pending under the previously recorded owner residual-risk decision; this GO is technical/operational and does not assert legal sufficiency.