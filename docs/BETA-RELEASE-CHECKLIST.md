# NOVELIGHT public-beta release checklist

This checklist is the final operational gate after code review/CI. A checked box must represent an observed result or a specifically justified still-valid result under `docs/EVIDENCE-FRESHNESS-GATE.md`, not an assumption.

**Reconciled: 2026-09-05 JST for current controlled-beta launch posture.**

Historical GO decision baseline: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1`.

Current material launch main at reconciliation: `b117655344a6c22cd3b419859e0e132cdaba469a`.

Qualified Japanese counsel review is **deferred/pending**, not completed. The owner residual-risk decision and deferred status are recorded in `docs/legal-beta-review.md`; checking the legal-status item below does not assert legal sufficiency.

**Controlled public-beta GO: RECORDED 2026-08-28; CURRENT LAUNCH POSTURE RECONCILED 2026-09-05.** See `docs/BETA-RELEASE-DECISION-2026-08-28.md` and `docs/BETA-RELEASE-EVIDENCE-LATEST.md`.

## Git / CI

- [x] Latest `main` and authoritative `docs/NOVELIGHT-MASTER.md` were re-fetched before reconciliation.
- [x] MASTER was read continuously from line 1 through confirmed EOF before repository mutation.
- [x] Exact current-main `NOVELIGHT CI` #1551 / run `33949965101` completed `success`.
- [x] Current-main aggregate `check`, Node tests, static quality, desktop/mobile smoke, and desktop/mobile async-UI browser jobs passed.
- [x] Desktop + mobile Playwright gates pass on the current exact-main CI matrix.
- [x] Current-main `CodeQL` #1476 / run `33949965123` passed.
- [x] Current-main Vercel commit status is `success`.
- [x] Exact current-main `NOVELIGHT Production Readiness Smoke` #85 / run `33949965108` passed.
- [x] Production Readiness job `Verify deployed public surfaces and production observability` passed static routes, safe API contracts, read-only Production reader smoke, and beta observability.
- [x] Merge Readiness preflight on the main push, RLS integration/rollback, dependency vulnerability audit, and GitHub Actions semantic lint were selectively skipped; this checklist does not misrepresent those jobs as current-main executions.
- [x] Earlier RLS/dependency/workflow evidence is reused only where later changes do not invalidate the proved boundary.

Current decisive exact-main repository evidence:

- `NOVELIGHT CI` #1551 / run `33949965101` / head `b117655344a6c22cd3b419859e0e132cdaba469a`: `success`.
- `CodeQL` #1476 / run `33949965123` / same head: `success`.
- `NOVELIGHT Production Readiness Smoke` #85 / run `33949965108` / same head: `success`.
- Vercel commit status for the same head: `success`.

## Supabase Production

- [x] Earlier beta Production migration/status/dry-run/postcheck/auth-redirect evidence remains recorded in historical release evidence.
- [x] `20260830163000_atomic_episode_publish.sql` received explicit OWNER approval through issue #165, executed successfully, and passed postcheck.
- [x] `20260830214000_checkout_attempt_reservations.sql` received explicit OWNER approval through issue #165, executed successfully, and passed postcheck.
- [x] `20260831210000_trusted_allocation_receipts.sql` received explicit OWNER approval through issue #165, bridge run `33498574140` executed successfully, and postcheck passed.
- [x] `20260901130000_harden_pv_counting.sql` received explicit OWNER approval through issue #165, bridge run `33526794913` executed successfully, and postcheck passed.
- [x] `20260902143000_beta_standard_free_entitlement.sql` received explicit OWNER approval through issue #165, bridge run `33610652517` executed successfully, and postcheck passed.
- [x] `20260903010000_admin_operations_hub` received explicit OWNER approval through issue #165 and is part of successful bridge run `33947319837`.
- [x] `20260904133000_official_novel_thumbnails` received explicit OWNER approval through issue #165 and is part of successful bridge run `33947319837`.
- [x] `20260904174500_harden_official_thumbnail_function_privileges` received explicit OWNER approval through issue #165 and is part of successful bridge run `33947319837`.
- [x] For bridge run `33947319837`, the ledger records `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"` for the three 2026-09-03/04 migrations.
- [x] All listed Production migrations were already applied before this reconciliation and are not repeated for documentary freshness.
- [x] Password recovery/signup redirect and profile/auth persistence evidence remains still-valid for its unchanged Production configuration scope.

## Backup / restore — hard GO gate

- [x] Production Supabase automatic backup capability was verified in the actual project; beta recovery posture is Pro scheduled backups rather than PITR.
- [x] Recovery window and scheduled-backup retention were recorded.
- [x] `NOVELIGHT Production Backup Freshness` #8 / run `33354249864` passed its read-only latest-backup freshness verifier.
- [x] Backup Freshness #8 head is `79e33341c90779270dfb7ebedec7ad2d34d3e32f`; no later change in this reconciliation requires a duplicate backup mutation or restore operation merely for documentary freshness.
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
- [x] Production ADMIN allowlist request issue #271 received exact OWNER approval, was claimed by apply run `33402197728`, and recorded `CONSUMED result="success"` without exposing the allowlist value.
- [x] `20260903010000_admin_operations_hub` is applied in Production with successful approval-ledger execution/postcheck evidence.
- [x] Production Auth Smoke #369 is not used to claim the ADMIN authorization boundary was smoke-tested.

## Discovery / LIGHT ANALYTICS / novel posting

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
- [x] Official novel-thumbnail schema is part of Production state after migration `20260904133000`.
- [x] Official-thumbnail function privileges are hardened after migration `20260904174500`.
- [x] PR #368 allows no-image novel posting only while the active official-thumbnail catalog is empty, retains required thumbnail selection once active assets exist, and retains fail-closed behavior for ordinary load errors.
- [x] Fresh exact-current Production authenticated smoke exercised the beta-critical author creation/publication and trusted reader/allocation path successfully after these changes.

## Beta-start data

- [x] X test URL with `utm_source=x` records an acquisition touch under existing beta-start evidence.
- [x] Registration/login claims first-touch acquisition to the signed-in user.
- [x] Daily revisit ledger records expected activity without raw visitor-token storage.
- [x] Direct/X detail and episode events persist independently of internal discovery attribution.
- [x] First qualifying authors receive concurrency-safe Founding Author #001–#100 records.
- [x] Verified Stripe webhook writes idempotent subscription event history.
- [x] Later login hardening prevents optional telemetry rejection from blocking a successful redirect.
- [x] Current exact-main browser CI and Production authenticated smoke pass after the later login, discovery, posting, and thumbnail changes.

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
- [x] No later merged change through current main alters the Stripe pricing/billing/entitlement contract proven by run `33612120034`.
- [x] Stripe Bootstrap, Vercel env sync/redeploy, billing transition, and live charges were not repeated during this documentary reconciliation.

## Legal / brand / public surfaces

- [x] Terms, privacy, content guidelines, billing policy, commerce disclosure and contact remain part of the public/read-only release surface.
- [x] Content guidelines describe the live report route in present tense under existing reviewed evidence.
- [x] Privacy policy describes the UTM/acquisition and pseudonymous beta activity/analytics processing used in beta under existing reviewed evidence.
- [x] PR #307 aligned pricing, billing policy, and commerce disclosure with Standard beta-free / Premium beta-480 pricing.
- [x] Exact current-main CI #1551, CodeQL #1476, Production Readiness #85, and Vercel status pass.
- [x] Stripe Bootstrap #7 remains the decisive current billing proof for the unchanged beta billing boundary.
- [x] Fresh exact-current Production Auth Smoke #369 passed Production page convergence and authenticated beta-critical flows.
- [x] Qualified Japanese counsel review remains deferred/pending and the accepted owner residual risk is explicit.

## Final authenticated smoke

Newest decisive Production authenticated proof:

- Request issue: `#369`, state `closed`, reason `completed`.
- Workflow: `NOVELIGHT Production Auth Smoke Approval Handler`.
- Run: `33951087810` (#447).
- Event: `issue_comment`.
- Exact approved/head main: `b117655344a6c22cd3b419859e0e132cdaba469a`.
- Conclusion: `success`.
- Decisive job `Verify authenticated beta-critical production flows`: `success`.
- Approval ledger: exact OWNER approval -> `CLAIMED` -> `CONSUMED`, `result="success"`, issue closed completed.
- Ephemeral Production smoke users/data creation: success.
- Authenticated Production browser smoke: success for the workflow's Desktop/Mobile contract.
- Ephemeral Production smoke-data cleanup: success.
- Temporary credential/fixture cleanup: success.
- Failed claimed-request path: skipped because the request succeeded.

Covered/current beta-critical contract includes:

- [x] Author authentication and author-side creation/publication flow
- [x] Reader authentication and reader-side reading/engagement flow
- [x] Favorite / LIGHT SEED / SCOUT RECORD / LIGHT ANALYTICS behavior exercised by the current smoke contract
- [x] Trusted allocation path required by the current Production schema
- [x] Cardless beta Standard activation
- [x] Premium Checkout-session path on a separate user without creating a live charge in the smoke
- [x] Desktop authenticated path
- [x] Mobile authenticated path
- [x] Work/smoke-data cleanup

Freshness classification:

- [x] #369 is **exact-current-main** proof for `b1176553...` and supersedes #312 for current beta-critical author/reader launch reliance.
- [x] #312 and earlier successful smoke runs remain historical evidence and are not relabeled current.
- [x] #369 is not claimed to prove ADMIN authorization.
- [x] #369 must not be repeated merely to produce a newer timestamp or refresh evidence documents.
- [x] The evidence set satisfies `scripts/evaluate-production-auth-smoke-evidence.mjs`: exact workflow/event, top-level success, one successful decisive job, exact head SHA, and one matching successful `CONSUMED` record with the same run ID/head SHA.

## Final release decision

- [x] Current `main` and authoritative release rules were re-fetched before this reconciliation.
- [x] Current material launch main remained `b117655344a6c22cd3b419859e0e132cdaba469a` through the pre-write freshness check.
- [x] Current exact-main repository scopes are supported by CI #1551 / `33949965101`, CodeQL #1476 / `33949965123`, Production Readiness #85 / `33949965108`, and Vercel success.
- [x] Post-GO Production migrations through `20260904174500` are explicitly reconciled with approval/execution/postcheck ledger evidence.
- [x] Backup hard-gate evidence remains current under Backup Freshness #8 and still-valid unchanged backup controls.
- [x] Production ADMIN allowlist state is reconciled through completed Issue #271 / apply run `33402197728`.
- [x] Production beta pricing is reconciled through PR #307 plus Stripe Production Bootstrap #7 / run `33612120034`.
- [x] Production authenticated beta-critical evidence is refreshed to exact-current Issue #369 / run `33951087810`.
- [x] Selectively skipped current-main CI jobs are not represented as having run.
- [x] Qualified Japanese counsel review remains explicitly deferred/pending rather than being represented as completed.
- [x] Controlled public-beta GO remains the historical decision recorded in `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

## Reconciliation result

All non-deferred hard-gate scopes above have current or specifically justified still-valid decisive evidence under `docs/EVIDENCE-FRESHNESS-GATE.md` for the current launch posture.

This checklist does not claim selectively skipped CI jobs ran and does not claim Production Auth Smoke #369 proves the ADMIN authorization boundary.

Qualified Japanese counsel review remains explicitly deferred/pending and is not represented as completed or as proof of legal compliance.

**Controlled public-beta GO: CURRENT LAUNCH POSTURE RECONCILED 2026-09-05.**

Current material launch main at reconciliation: `b117655344a6c22cd3b419859e0e132cdaba469a`.

This reconciliation does not authorize Production DB/RLS changes, Stripe live mutations, Secret/env changes, destructive/high-impact operations, manual Production workflow reruns, or unrelated Production state changes. If this reconciliation itself advances `main` only through these two release-documentation changes, the evidence classifications above remain current. Any later material launch-state change must refresh only its affected evidence scope before the recorded GO is relied upon.
