# NOVELIGHT public-beta release checklist

This checklist is the final operational gate after code review/CI. A checked box must represent an observed result or a specifically justified still-valid result under `docs/EVIDENCE-FRESHNESS-GATE.md`, not an assumption.

**Reconciled: 2026-08-31 JST for current controlled-beta launch posture.**

Historical GO decision baseline: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1`.

Current launch main at reconciliation: `c00bf121ae261e4eca26cb7e05cfb8abb3cfbbdd`.

Qualified Japanese counsel review is **deferred/pending**, not completed. The owner residual-risk decision and deferred status are recorded in `docs/legal-beta-review.md`; checking the legal-status item below does not assert legal sufficiency.

**Controlled public-beta GO: RECORDED 2026-08-28; CURRENT LAUNCH POSTURE RECONCILED 2026-08-31.** See `docs/BETA-RELEASE-DECISION-2026-08-28.md` and `docs/BETA-RELEASE-EVIDENCE-LATEST.md`.

## Git / CI

- [x] Release evidence was reconciled against current `main` and the authoritative `docs/NOVELIGHT-MASTER.md`.
- [x] Exact current-main `NOVELIGHT CI` #1196 / run `33368084498` completed `success`.
- [x] Current-main aggregate `check`, Node tests, static quality, desktop/mobile smoke, and desktop/mobile async-UI browser jobs passed.
- [x] Current-main `CodeQL` #1128 / run `33368084384` passed.
- [x] Current-main Vercel deployment status is `success`.
- [x] Exact current-main `NOVELIGHT Production Readiness Smoke` #58 / run `33368084397` passed.
- [x] Production Readiness #58 passed Production static-route, safe-API-contract, read-only reader, and observability checks.
- [x] RLS integration/rollback, dependency vulnerability audit, and GitHub Actions semantic lint were **selectively skipped** on current main because PR #265 did not change their trigger file classes; this checklist does not misrepresent those jobs as current-main executions.
- [x] Still-valid earlier RLS/dependency/workflow evidence is reused only where the Evidence Freshness Gate permits it and where no later material change invalidated that scope.

Current decisive exact-main evidence:

- `NOVELIGHT CI` #1196 / run `33368084498` / head `c00bf121ae261e4eca26cb7e05cfb8abb3cfbbdd`: `success`.
- `CodeQL` #1128 / run `33368084384` / same head: `success`.
- Vercel commit status for the same head: `success`.
- `NOVELIGHT Production Readiness Smoke` #58 / run `33368084397` / same head: `success`.

## Supabase Production

- [x] Earlier beta Production migration/status/dry-run/postcheck/auth-redirect evidence remains recorded in the historical release evidence.
- [x] Post-GO migration `20260830163000_atomic_episode_publish.sql` received explicit OWNER approval through issue #165, was claimed by bridge run `33307362222`, executed successfully, and passed postcheck.
- [x] Post-GO migration `20260830214000_checkout_attempt_reservations.sql` received explicit OWNER approval through issue #165, was claimed by bridge run `33346664018`, executed successfully, and passed postcheck.
- [x] The two later Production migrations are now included in the current-state reconciliation rather than being omitted behind the obsolete statement that no later migration existed.
- [x] PR #265 adds no Supabase migration, Production DB write path, Stripe mutation, or committed secret.
- [x] Password recovery/signup redirect and profile/auth persistence evidence remains still-valid for its unchanged Production configuration scope.

## Backup / restore — hard GO gate

- [x] Production Supabase automatic backup capability was verified in the actual project; beta recovery posture is Pro scheduled backups rather than PITR.
- [x] Recovery window and scheduled-backup retention were recorded.
- [x] `NOVELIGHT Production Backup Freshness` #8 / run `33354249864` passed its read-only latest-backup freshness verifier.
- [x] Backup Freshness #8 head is `79e33341c90779270dfb7ebedec7ad2d34d3e32f`; compare through current launch main does not change the backup workflow, backup-freshness script, or Production backup control path.
- [x] `docs/BACKUP-RESTORE-RUNBOOK.md` was reviewed.
- [x] Non-production restore rehearsal completed and was recorded without a destructive Production restore.
- [x] Backup Freshness was not manually rerun merely to refresh this document.

## Content / moderation / operator boundary

- [x] New published work requires AI-use classification.
- [x] Mature work requires one or more content warnings.
- [x] Mature direct episode URL shows a warning gate.
- [x] Prohibited sexually explicit/pornographic beta rule is visible before publishing.
- [x] Novel and episode report submissions reach `content_reports` under existing evidence.
- [x] Raw report rows are not readable by ordinary anon/authenticated clients under existing evidence.
- [x] Operator has a documented routine to inspect new reports/support inquiries during controlled beta.
- [x] PR #265 ADMIN v1 is read-only and requires server-side bearer-token verification plus a server-side allowlist.
- [x] Missing/malformed ADMIN allowlist configuration fails closed; non-admin authenticated callers are denied before data loaders run.
- [x] ADMIN API is GET-only, uses private/no-store caching, rejects cross-site requests, and omits sensitive raw identifiers/content described in PR #265.
- [x] PR #265 received exact-final-head High-Risk OWNER approval before merge.
- [x] Current-main CI, CodeQL, Vercel, and Production Readiness safe-API checks passed after the ADMIN merge.
- [x] No open `[OPS] NOVELIGHT beta inbox needs review` issue was found during the 2026-08-31 reconciliation.

## Discovery / LIGHT ANALYTICS

- [x] A new Free work can be selected by the initial-exposure priority when discovery traffic exists.
- [x] General feed still includes Free / Standard / Premium.
- [x] Standard plan-only exposure records `home_plan_extra`.
- [x] Premium dedicated exposure remains separate from the general feed.
- [x] Search recommended, new, PV and favorite sorts record visible impressions under existing evidence.
- [x] LIGHT ANALYTICS covers impression -> detail CTR.
- [x] LIGHT ANALYTICS covers detail -> episode 1 rate.
- [x] LIGHT ANALYTICS covers episode 1 -> episode 2 rate.
- [x] Standard/Premium plan-added impressions can be read as actual recorded counts.
- [x] PR #265 does not alter discovery selection or the reader analytics pipeline; current-main CI/CodeQL/Readiness provide regression reinforcement.

## Beta-start data

- [x] X test URL with `utm_source=x` records an acquisition touch under existing beta-start evidence.
- [x] Registration/login claims first-touch acquisition to the signed-in user.
- [x] Daily revisit ledger records expected activity without raw visitor-token storage.
- [x] Direct/X detail and episode events persist independently of internal discovery attribution.
- [x] First qualifying authors receive concurrency-safe Founding Author #001–#100 records.
- [x] Verified Stripe webhook writes idempotent subscription event history.
- [x] PR #265 only adds `/admin.html` to the existing same-origin safe login redirect allowlist; existing author/reader sign-in/session logic remains unchanged.

## Legal / brand / public surfaces

- [x] Terms, privacy, content guidelines, billing policy, commerce disclosure and contact remain part of the public/read-only release surface.
- [x] Content guidelines describe the live report route in present tense under existing reviewed evidence.
- [x] Privacy policy describes the UTM/acquisition and pseudonymous beta activity/analytics processing used in beta under existing reviewed evidence.
- [x] Exact current-main Production Readiness #58 passed for Production static routes, safe API contracts, read-only reader behavior, and observability.
- [x] Final Japanese legal review status has been recorded; qualified counsel review is deferred/pending and the accepted owner residual risk is explicit.

## Final authenticated smoke

The newest Production authenticated proof for the **pre-existing beta-critical author/reader flow** is:

- `NOVELIGHT Production Authenticated Smoke` #163 / run `33362071374`.
- Exact approved main: `d2b21f647e67104cf40476685b86afac274222ce`.
- Approval ledger: issue #263, exact OWNER approval -> `CLAIMED` -> `CONSUMED`, `result="success"`, issue closed completed.
- Approved-main re-check, Production page convergence, authenticated browser smoke, ephemeral Production data cleanup, and temporary credential/fixture cleanup all succeeded.

Covered beta-critical scope includes:

- [x] Author login
- [x] Work creation
- [x] Episode publication
- [x] Reader login
- [x] Novel detail / episode reading
- [x] Favorite
- [x] LIGHT SEED
- [x] SCOUT RECORD
- [x] LIGHT ANALYTICS engagement/funnel behavior exercised by the smoke
- [x] No-charge Stripe Checkout-session creation
- [x] Work deletion / smoke cleanup

Freshness classification after current-main PR #265:

- [x] #163 remains **still current for the proved pre-existing author/reader scope** because `d2b21f... -> c00bf121...` adds the read-only ADMIN surface and an additive `/admin.html` safe redirect destination without changing existing sign-in/session behavior, existing author/reader destinations, user-facing billing flow, Supabase Auth configuration, or user DB/RLS schema.
- [x] #163 is **not** used to claim that the new operator ADMIN authorization boundary was Production-auth smoke tested.
- [x] The new ADMIN boundary is separately supported by PR #265 High-Risk OWNER approval plus exact-current-main CI #1196, CodeQL #1128, Vercel success, and Production Readiness #58.
- [x] #163 must not be repeated merely to produce a newer timestamp or refresh evidence documents.

## Production billing proof

- [x] Existing external Stripe webhook proof run `33065836764` remains accepted current for its scoped no-charge live delivery/entitlement/cancellation/final-audit contract.
- [x] No later material change to `api/stripe-webhook.js`, the decisive webhook-handler boundary, endpoint/signing-secret state, or Production Supabase target was identified.
- [x] The checkout-attempt reservation migration changes initial Checkout concurrency, not the proved external webhook delivery boundary.
- [x] The live webhook proof was not re-run for documentary freshness.

## Final release decision

- [x] Current `main` and authoritative release rules were re-fetched before this reconciliation.
- [x] A concurrent material main advance during reconciliation was detected; the stale `d2b21f...` write path was stopped and evidence was re-evaluated against new main `c00bf121...` before editing release documents.
- [x] Current exact-main scopes are supported by CI #1196, CodeQL #1128, Vercel success, and Production Readiness #58.
- [x] Post-GO Production migrations `20260830163000` and `20260830214000` are explicitly reconciled with their approval/execution/postcheck ledger evidence.
- [x] Backup hard-gate evidence is refreshed to read-only Backup Freshness #8 and later backup-control-path compare.
- [x] Existing Production authenticated #163 evidence was freshness-classified narrowly rather than falsely relabeled as an exact-current-main run.
- [x] Existing Production external Stripe webhook evidence remains current without duplicate live execution.
- [x] No open Beta Ops Inbox alert issue was found during this reconciliation.
- [x] Qualified Japanese counsel review remains explicitly deferred/pending rather than being represented as completed.
- [x] Controlled public-beta GO remains the historical decision recorded in `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

## Reconciliation result

All non-deferred hard-gate scopes above have current or specifically justified still-valid decisive evidence under `docs/EVIDENCE-FRESHNESS-GATE.md` for the current launch posture.

This checklist does not claim that selectively skipped CI jobs ran, and it does not claim that Production Authenticated Smoke #163 proves the newly added operator ADMIN authorization boundary.

Qualified Japanese counsel review remains explicitly deferred/pending and is not represented as completed or as proof of legal compliance.

**Controlled public-beta GO: CURRENT LAUNCH POSTURE RECONCILED 2026-08-31.**

Current launch main at reconciliation: `c00bf121ae261e4eca26cb7e05cfb8abb3cfbbdd`.

This reconciliation does not authorize Production DB/RLS changes, Stripe live mutations, Secret/env changes, destructive/high-impact operations, manual Production workflow reruns, or unrelated Vercel Production state changes. If this reconciliation itself advances `main` only through these release-documentation changes, the evidence classifications above remain current. Any later material launch-state change must refresh only its affected evidence scope before the recorded GO is relied upon.