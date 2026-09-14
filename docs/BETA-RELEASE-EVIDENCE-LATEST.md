# NOVELIGHT β Release Evidence — Latest Reconciled State

**Reconciled: 2026-09-14 JST**

This file is the rolling current-state index required by `docs/EVIDENCE-FRESHNESS-GATE.md`. Dated `BETA-RELEASE-EVIDENCE-*.md` files remain historical snapshots and are not rewritten. Older proof is reused only when its scope is still valid after later material changes.

## Release decision

**Historical controlled public-beta GO: RECORDED 2026-08-28.**

**Current technical/operational launch posture: GO WITH SCOPE-LIMITED HISTORICAL PROOF — current repository/main evidence is green through PR #557, Vercel Production reports success for current main `69ed457c8a057fdb9fe69d05c03b078d164b370c`, and the later beta-critical changes have been reconciled against the available Production evidence without rerunning Production mutations merely for documentary freshness.**

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING** with residual risk recorded in `docs/legal-beta-review.md`. This is an operational release posture, not a finding of legal sufficiency.

Current main at this reconciliation:

- `69ed457c8a057fdb9fe69d05c03b078d164b370c` — `Fix per-work favorite conversion rate (#557)`.

## Exact-current repository and deployment evidence

For current main `69ed457c8a057fdb9fe69d05c03b078d164b370c`:

- NOVELIGHT CI #2327: `SUCCESS`.
- aggregate required `check`: `SUCCESS`.
- CodeQL #2234: `SUCCESS`.
- Vercel Production commit status: `SUCCESS`.
- PR #557 is squash-merged and the merge SHA is exactly `69ed457c8a057fdb9fe69d05c03b078d164b370c`.

The PR #557 approved head `50380cb4074fbba9f460a93690a4f3d9e52b613c` independently passed NOVELIGHT CI #2326 and CodeQL #2233 before merge. The current rolling decision uses the later successful main evidence when available and does not relabel older PR-head proof as a different execution.

## Material beta-critical changes reconciled after the prior rolling snapshot

The previous rolling index was centered on PR #530 and therefore did not represent the material work merged afterward. The following later changes are now part of the current release state:

- Chapter 41 beta policy: Work Rank continues to be calculated and stored internally, but Rank 1–6 / EMBER–NOVA is hidden from ordinary reader/author UI during beta. Internal Rank remains usable for discovery logic and later SCOUT calculation.
- SCOUT RECORD beta behavior: unreleased Level/Rank/badge/XP information remains locked; the beta-facing preview does not expose hidden user progression. LIGHT SEED send history remains a separate beta-available function.
- PR #539 preserves safe reader context across login/signup so a reader can return to the work/episode context that caused authentication.
- PR #542 aligns Production Auth Smoke navigation with the Chapter 41 LIGHT SEED history split.
- PR #547 adds beta LIGHT READY pre-publication checks.
- PR #549 adds trusted public impression receipts for beta analytics and discovery surfaces.
- PR #551 adds migration safety artifacts for the trusted-impression change.
- PR #553 fixes Staging Smoke dependencies and restores bounded public official-thumbnail lookup/coverage for search and ranking surfaces.
- PR #555 fixes warning-gated work-detail-open analytics and adds regression coverage.
- PR #557 fixes the per-work LIGHT ANALYTICS favorite conversion denominator to the formal definition: **favorites / impressions**, not favorites / episode-2 continuations, and adds regression coverage.

These changes complete/reinforce the MASTER Chapter 24 beta-A requirement that the basic exposure/read/favorite funnel be measurable and basically visible. They do not justify treating every older Production proof as exact-current; freshness is classified per scope below.

## Evidence freshness classifications

| Scope | Newest decisive evidence used by this reconciliation | Freshness classification | Current status |
| --- | --- | --- | --- |
| Repository CI / regression | current-main NOVELIGHT CI #2327 + aggregate `check` | exact-current | PASS |
| CodeQL | current-main CodeQL #2234 | exact-current | PASS |
| Vercel Production deployment | commit status on `69ed457c...` | exact-current | PASS |
| PR #557 favorite-rate correction | merged SHA `69ed457c...` plus regression coverage | exact-current | PASS |
| Chapter 41 Rank-hidden / SCOUT beta presentation | merged implementation chain through current main | current repository behavior | PASS |
| Reader auth-context continuity | PR #539 | current-by-scope | PASS |
| LIGHT READY beta checks | PR #547 | current-by-scope | PASS |
| Trusted public impression receipts | PR #549 plus migration-safety follow-up #551 | current-by-scope; Production ledger recorded separately | PASS WITH SCOPE LIMIT |
| Public official-thumbnail lookup / Staging coverage | PR #553 plus existing official-thumbnail Production state | current-by-scope | PASS WITH SCOPE LIMIT |
| Warning-gated work-detail-open analytics | PR #555 | current-by-scope | PASS |
| Production Readiness | latest reconciled Production Readiness #141 | current-by-scope, not represented as exact-current execution of every later analytics-only change | PASS WITH SCOPE LIMIT |
| Authenticated Chapter 38/40 create/render flow | Issue #511 / run `34692176490` on `e4e8673d...` | still-valid only for the actually executed unchanged Chapter 38/40 scope | PASS WITH SCOPE LIMIT |
| Backup freshness | Production Backup Freshness #65 / run `34829215089` | current-by-scope | PASS |
| Qualified Japanese counsel | owner-deferred | unchanged | PENDING / ACCEPTED RESIDUAL RISK |

## Production Authenticated Smoke scope boundary

Issue #511 / run `34692176490` remains a valid successful approval-gated Production Authenticated Smoke for the behavior it actually executed, including the Chapter 38/40 authenticated beta-critical create/render path. It is **not** expanded into evidence for later behavior that the run did not exercise.

Specifically, #511 is not treated as direct Production proof of:

- the later Chapter 41 reader-facing Rank-hidden policy;
- the later locked SCOUT RECORD preview behavior;
- LIGHT READY added by PR #547;
- trusted public impression receipts added by PR #549;
- bounded public official-thumbnail lookup added/restored by PR #553;
- warning-gated detail-open analytics fixed by PR #555;
- the per-work favorite-rate denominator fix in PR #557.

No Production Auth Smoke was requested or rerun merely to make its proof SHA equal current main. Request-only workflow success is not classified as authenticated Production PASS without the required decisive verification job and matching consumed ledger record.

## Supabase / Production migration evidence

Previously reconciled Chapter 38 and Chapter 40 Production state remains historical/current-by-scope evidence and is not repeated for documentation freshness.

The post-snapshot work additionally records successful Production migration ledger evidence for migration IDs:

- `20260913112358`
- `20260913141000`

Those migrations are recorded as already applied successfully in the release evidence gathered for Issue #558. This reconciliation does **not** rerun them, apply a new migration, alter Production data, or change RLS/permissions.

If future code changes touch these migration-controlled behaviors, the corresponding Production evidence must be reclassified under `docs/EVIDENCE-FRESHNESS-GATE.md`; this document must not be used to justify duplicate mutation.

## LIGHT ANALYTICS beta-A funnel state

The beta-A basic funnel is now reconciled as:

1. impressions / exposure;
2. work-detail CTR / arrival;
3. reading start / first-episode progress;
4. episode-2 continuation;
5. favorite conversion.

The per-work favorite conversion follows the same formal denominator as the aggregate analytics contract: impressions. The former episode-2 denominator is no longer the current implementation and regression coverage exists to prevent drift back to it.

Trusted public impression receipts and warning-gated work-detail-open handling close measurement gaps that could otherwise undercount or misattribute the public discovery path.

This does not claim that advanced benchmarking, automated diagnosis, or AI improvement advice is beta-A complete; MASTER Chapter 24 explicitly places those beyond the mandatory basic funnel scope.

## Official thumbnail evidence

Chapter 40 Geometry Thumbnail Engine and official-thumbnail Production setup remain previously verified. PR #553 later restores/guards the public lookup surfaces needed by search/ranking and aligns Staging coverage with the Chapter 40 composer.

The current release posture therefore distinguishes:

- existing Production official-thumbnail state: previously established and not remutated here;
- later public lookup/application behavior: covered by the merged PR #553 implementation and current repository gates;
- authenticated Chapter 40 create/render persistence: still-valid only under the scope of Issue #511.

No official asset registration or Production thumbnail mutation is repeated for evidence freshness.

## Backup / recovery

The newest reconciled backup freshness evidence is Production Backup Freshness #65 / run `34829215089`.

Existing recovery/restore evidence remains scope-limited historical proof unless a later backup-control change invalidates it. This reconciliation performs no restore, database mutation, or destructive test.

## Stripe / billing

No post-#530 change reconciled here requires a Stripe live mutation, pricing change, entitlement change, Secret change, or new billing proof. Existing successful Stripe Production evidence remains historical/current-by-scope unless a later billing-path change invalidates it.

This reconciliation performs no Stripe operation.

## Residual risks and release discipline

The technical/operational beta posture remains GO, but the following qualifications remain explicit:

- qualified Japanese counsel review is still pending/deferred by OWNER;
- Production Auth Smoke proof is scope-limited and is not stretched over later unexecuted behavior;
- Production Readiness evidence is classified by actual scope rather than falsely called exact-current for unrelated later analytics changes;
- future material changes after `69ed457c...` must trigger a new freshness comparison before this file is used for release decisions.

## No-mutation statement for this reconciliation

Issue #558 and this documentation reconciliation perform **no**:

- Production Supabase/DB mutation;
- migration execution or rerun;
- Stripe/billing/entitlement mutation;
- Secret/environment-variable mutation;
- Vercel Production state mutation beyond the already-existing deployment evidence;
- Production Auth Smoke run for documentary freshness;
- product-code change;
- image generation or image editing.

The purpose of this update is to make the rolling release index truthful after the material beta-hardening work through PR #557, while preserving the distinction between exact-current, current-by-scope, and historical scope-limited proof.
