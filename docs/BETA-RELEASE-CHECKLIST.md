# NOVELIGHT public-beta release checklist

This checklist is the final operational gate after code review/CI. A checked box must represent an observed result or a specifically justified still-valid result under `docs/EVIDENCE-FRESHNESS-GATE.md`, not an assumption.

**Reconciled: 2026-09-02 JST for current controlled-beta launch posture.**

Historical GO decision baseline: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1`.

Current material launch main at reconciliation: `cdd04a0ec0abfe3eb4c1ff81325e00d7d6bfc5b3`.

Qualified Japanese counsel review is **deferred/pending**, not completed. The owner residual-risk decision and deferred status are recorded in `docs/legal-beta-review.md`; checking the legal-status item below does not assert legal sufficiency.

**Controlled public-beta GO: RECORDED 2026-08-28; CURRENT LAUNCH POSTURE RECONCILED 2026-09-02.** See `docs/BETA-RELEASE-DECISION-2026-08-28.md` and `docs/BETA-RELEASE-EVIDENCE-LATEST.md`.

## Git / CI

- [x] Latest `main` and authoritative `docs/NOVELIGHT-MASTER.md` were re-fetched before reconciliation.
- [x] MASTER was read continuously from line 1 through confirmed EOF before repository mutation.
- [x] Exact current-main `NOVELIGHT CI` #1367 / run `33640026505` completed `success`.
- [x] Current-main aggregate `check`, Node tests, static quality, desktop/mobile smoke, and desktop/mobile async-UI browser jobs passed.
- [x] Current-main `CodeQL` #1298 / run `33640026461` passed.
- [x] Current-main Vercel commit status is `success`.
- [x] RLS integration/rollback, dependency vulnerability audit, and GitHub Actions semantic lint were selectively skipped by the current-main CI classifier because PR #311 did not change their trigger file classes; this checklist does not misrepresent those jobs as current-main executions.
- [x] Earlier RLS/dependency/workflow evidence is reused only where later changes do not invalidate the proved boundary.
- [x] Production Readiness #58 / run `33368084397` on `c00bf121...` is retained only as historical/still-valid route/read-only baseline evidence; it is not falsely described as exact-current proof for pricing/public text changed by PR #307.

Current decisive exact-main repository evidence:

- `NOVELIGHT CI` #1367 / run `33640026505` / head `cdd04a0ec0abfe3eb4c1ff81325e00d7d6bfc5b3`: `success`.
- `CodeQL` #1298 / run `33640026461` / same head: `success`.
- Vercel commit status for the same head: `success`.

## Supabase Production

- [x] Earlier beta Production migration/status/dry-run/postcheck/auth-redirect evidence remains recorded in historical release evidence.
- [x] `20260830163000_atomic_episode_publish.sql` received explicit OWNER approval through issue #165, executed successfully, and passed postcheck.
- [x] `20260830214000_checkout_attempt_reservations.sql` received explicit OWNER approval through issue #165, executed successfully, and passed postcheck.
- [x] `20260831210000_trusted_allocation_receipts.sql` received explicit OWNER approval through issue #165, bridge run `33498574140` executed successfully, and postcheck passed.
- [x] `20260901130000_harden_pv_counting.sql` received explicit OWNER approval through issue #165, bridge run `33526794913` executed successfully, and postcheck passed.
- [x] `20260902143000_beta_standard_free_entitlement.sql` received explicit OWNER approval through issue #165, bridge run `33610652517` executed successfully, and postcheck passed.
- [x] The Production migration ledger records `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"` for each of the three 2026-09-01/02 migration deployments above.
- [x] All listed Production migrations were already applied before this reconciliation and are not repeated for documentary freshness.
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
- [x] ADMIN v1 is read-only and requires server-side bearer-token verification plus a server-side allowlist.
- [x] Missing/malformed ADMIN allowlist configuration fails closed; non-admin authenticated callers are denied before data loaders run.
- [x] ADMIN API is GET-only and uses private/no-store caching under the existing reviewed implementation.
- [x] Production ADMIN allowlist request issue #271 received exact OWNER approval, was claimed by apply run `33402197728`, and recorded `CONSUMED result="success"` with a Production deployment ID.
- [x] The allowlist value itself is not recorded in the durable issue evidence; only its fingerprint and successful state transition are persisted.
- [x] Current-main CI, CodeQL, and Vercel status pass after later auth/billing changes.
- [x] Production Auth Smoke #312 is not used to claim the ADMIN authorization boundary was smoke-tested.

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
- [x] Trusted allocation receipts are part of Production state after migration `20260831210000` success/postcheck.
- [x] PV counting is server-authoritative after migration `20260901130000` success/postcheck.
- [x] Fresh current-main Production authenticated smoke exercised the trusted beta-critical reader/allocation path successfully on Desktop and Mobile.

## Beta-start data

- [x] X test URL with `utm_source=x` records an acquisition touch under existing beta-start evidence.
- [x] Registration/login claims first-touch acquisition to the signed-in user.
- [x] Daily revisit ledger records expected activity without raw visitor-token storage.
- [x] Direct/X detail and episode events persist independently of internal discovery attribution.
- [x] First qualifying authors receive concurrency-safe Founding Author #001–#100 records.
- [x] Verified Stripe webhook writes idempotent subscription event history.
- [x] Later login hardening prevents optional telemetry rejection from blocking a successful redirect.
- [x] Current exact-main browser CI and Production authenticated smoke pass after that login hardening.

## Beta pricing / Production billing

- [x] Standard beta pricing is `0円` and does not require credit-card registration.
- [x] Premium beta special pricing is `月額480円`.
- [x] Premium regular/formal price remains `月額1,980円`; beta-end price-transition conditions are communicated in advance under the existing billing policy.
- [x] PR #307 material billing head is `3ad58fc878ac5ce7880ee2e55d946ffbe8a8fbfe`.
- [x] `NOVELIGHT Stripe Production Bootstrap` #7 / run `33612120034` completed `success` on that head.
- [x] Stripe live beta objects were provisioned/verified successfully.
- [x] Production Vercel variables were synchronized and verified successfully.
- [x] Production was redeployed with beta-pricing variables successfully.
- [x] Production beta billing API routes became healthy.
- [x] Existing live subscriptions were transitioned to beta pricing successfully.
- [x] No-charge Production beta billing control proof passed.
- [x] Final Production billing consistency audit passed.
- [x] Run `33612120034` supersedes older run `33065836764` as current billing/webhook proof for the changed PR #307 boundary; the older proof remains historical only.
- [x] Stripe Bootstrap, Vercel env sync/redeploy, and billing transition were not repeated during this documentary reconciliation.

## Legal / brand / public surfaces

- [x] Terms, privacy, content guidelines, billing policy, commerce disclosure and contact remain part of the public/read-only release surface.
- [x] Content guidelines describe the live report route in present tense under existing reviewed evidence.
- [x] Privacy policy describes the UTM/acquisition and pseudonymous beta activity/analytics processing used in beta under existing reviewed evidence.
- [x] PR #307 aligned pricing, billing policy, and commerce disclosure with Standard beta-free / Premium beta-480 pricing.
- [x] Exact current-main CI #1367, CodeQL #1298, and Vercel status pass after those public-surface changes.
- [x] Stripe Bootstrap #7 successfully redeployed Production and verified beta billing route health after the pricing/public-policy change.
- [x] Fresh exact-current Production Auth Smoke #312 passed Production page convergence and authenticated Desktop/Mobile flows after the billing change.
- [x] Historical Production Readiness #58 is not mislabeled as exact-current content proof after PR #307.
- [x] Final Japanese legal review status has been recorded; qualified counsel review is deferred/pending and the accepted owner residual risk is explicit.

## Final authenticated smoke

Newest decisive Production authenticated proof:

- Request issue: `#312`, state `closed`, reason `completed`.
- Workflow: `NOVELIGHT Production Auth Smoke Approval Handler`.
- Run: `33640915840` (#358).
- Event: `issue_comment`.
- Exact approved/head main: `cdd04a0ec0abfe3eb4c1ff81325e00d7d6bfc5b3`.
- Conclusion: `success`.
- Decisive job `Verify authenticated beta-critical production flows`: `success`.
- Approval ledger: exact OWNER approval -> `CLAIMED` -> `CONSUMED`, `result="success"`, issue closed completed.
- Desktop authenticated smoke: PASS.
- Mobile authenticated smoke: PASS.
- Ephemeral Production smoke-data cleanup: success.
- Temporary credential/fixture cleanup: success.

Covered/current beta-critical contract includes:

- [x] Author authentication and author-side creation/publication flow
- [x] Reader authentication and reader-side reading/engagement flow
- [x] Favorite / LIGHT SEED / SCOUT RECORD / LIGHT ANALYTICS behavior exercised by the current smoke contract
- [x] Trusted allocation path required by the current Production schema
- [x] Cardless beta Standard activation
- [x] Premium Checkout path on a separate user without creating a live charge in the smoke
- [x] Desktop authenticated path
- [x] Mobile authenticated path
- [x] Work/smoke-data cleanup

Freshness classification:

- [x] #312 is **exact-current-main** proof for `cdd04a0...` and supersedes #163 for current beta-critical author/reader launch reliance.
- [x] #163 remains historical evidence and is not relabeled current.
- [x] #312 is not claimed to prove ADMIN authorization.
- [x] #312 must not be repeated merely to produce a newer timestamp or refresh evidence documents.

## Final release decision

- [x] Current `main` and authoritative release rules were re-fetched before this reconciliation.
- [x] Current material launch main remained `cdd04a0ec0abfe3eb4c1ff81325e00d7d6bfc5b3` through the pre-write freshness check.
- [x] Current exact-main repository scopes are supported by CI #1367 / `33640026505`, CodeQL #1298 / `33640026461`, and Vercel success.
- [x] Post-GO Production migrations through `20260902143000` are explicitly reconciled with their approval/execution/postcheck ledger evidence.
- [x] Backup hard-gate evidence remains current under Backup Freshness #8 plus unaffected backup-control-path comparison.
- [x] Production ADMIN allowlist state is reconciled through completed Issue #271 / apply run `33402197728`.
- [x] Production beta pricing is reconciled through PR #307 plus Stripe Production Bootstrap #7 / run `33612120034`.
- [x] Production authenticated beta-critical evidence is refreshed to exact-current Issue #312 / run `33640915840` without duplicate execution.
- [x] Historical Production Readiness #58 and external webhook proof `33065836764` are scope-classified rather than falsely relabeled exact-current after material changes.
- [x] Qualified Japanese counsel review remains explicitly deferred/pending rather than being represented as completed.
- [x] Controlled public-beta GO remains the historical decision recorded in `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

## Reconciliation result

All non-deferred hard-gate scopes above have current or specifically justified still-valid decisive evidence under `docs/EVIDENCE-FRESHNESS-GATE.md` for the current launch posture.

This checklist does not claim that selectively skipped CI jobs ran, does not claim historical Production Readiness #58 proves later changed pricing text, and does not claim Production Auth Smoke #312 proves the ADMIN authorization boundary.

Qualified Japanese counsel review remains explicitly deferred/pending and is not represented as completed or as proof of legal compliance.

**Controlled public-beta GO: CURRENT LAUNCH POSTURE RECONCILED 2026-09-02.**

Current material launch main at reconciliation: `cdd04a0ec0abfe3eb4c1ff81325e00d7d6bfc5b3`.

This reconciliation does not authorize Production DB/RLS changes, Stripe live mutations, Secret/env changes, destructive/high-impact operations, manual Production workflow reruns, or unrelated Vercel Production state changes. If this reconciliation itself advances `main` only through release-documentation and MASTER pricing-record changes, the evidence classifications above remain current. Any later material launch-state change must refresh only its affected evidence scope before the recorded GO is relied upon.
