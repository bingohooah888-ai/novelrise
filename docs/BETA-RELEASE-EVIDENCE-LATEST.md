# NOVELIGHT β Release Evidence — Latest Reconciled State

**Reconciled: 2026-09-02 JST**

This file is the rolling current-state index required by `docs/EVIDENCE-FRESHNESS-GATE.md`. Dated `BETA-RELEASE-EVIDENCE-*.md` files remain historical snapshots and are not rewritten. Newer same-scope workflow, approval-ledger, compare, or read-only live evidence supersedes older descriptive status when no later material change invalidates the proof.

## Release decision

**Controlled public-beta GO: RECORDED 2026-08-28; CURRENT LAUNCH POSTURE RECONCILED 2026-09-02.**

Decision record: `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Historical decision baseline main: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1` (`Reconcile beta release evidence closure (#198)`).

Current material launch main at this reconciliation: `cdd04a0ec0abfe3eb4c1ff81325e00d7d6bfc5b3` (`Align Production Auth Smoke with beta billing (#311)`).

The GO decision remains historical and is not rewritten. Material product/auth/billing/database/release-control changes landed after the 2026-08-31 rolling reconciliation, so older proof is reused only for an unchanged scope. Affected scopes below are refreshed with 2026-09-01/02 exact-SHA CI, approval-ledger, Production migration, Stripe/Vercel, and authenticated-smoke evidence.

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING** with owner residual risk recorded in `docs/legal-beta-review.md`. This GO is an operational release decision, not a finding of legal sufficiency.

## Git / CI — PASS / CURRENT

Exact current-main evidence for `cdd04a0ec0abfe3eb4c1ff81325e00d7d6bfc5b3`:

- `NOVELIGHT CI` #1367 / run `33640026505`: `success`.
- Required aggregate `check`: `success`.
- Node tests: `success`.
- Static quality: `success`.
- Desktop smoke: `success`.
- Mobile smoke: `success`.
- Desktop async-UI browser regression: `success`.
- Mobile async-UI browser regression: `success`.
- `CodeQL` #1298 / run `33640026461`: `success`.
- Vercel commit status for the same head: `success`.

The current-main CI classifier skipped RLS integration/rollback, dependency vulnerability audit, and GitHub Actions semantic lint because PR #311 did not change their trigger file classes. This reconciliation does **not** represent those skipped jobs as having run on `cdd04a0...`; their earlier evidence is reused only where later compares show the proved boundary was not invalidated.

`NOVELIGHT Production Readiness Smoke` #58 / run `33368084397` on `c00bf121ae261e4eca26cb7e05cfb8abb3cfbbdd` remains historical read-only evidence for the unchanged route/read-only baseline. It is no longer described as exact-current proof for billing/public text changed later by PR #307. Current billing/auth/public deployment state is instead reinforced by exact-current CI/CodeQL/Vercel, the successful Production beta-pricing bootstrap below, and the fresh exact-current authenticated smoke.

## Supabase Production — PASS / CURRENT VIA APPROVAL LEDGER

Earlier Production migration/auth evidence remains recorded in dated release evidence. The rolling state additionally includes these post-GO migrations, all executed through the Production approval ledger with mutation and postcheck success:

- `20260830163000_atomic_episode_publish.sql`
  - approved main: `e43e8b9003b7bad5ab0b2b84b8b20b00b31e8501`
  - ledger: issue `#165`
  - bridge run: `33307362222`
  - execution/postcheck: `success`
- `20260830214000_checkout_attempt_reservations.sql`
  - approved main: `79e33341c90779270dfb7ebedec7ad2d34d3e32f`
  - ledger: issue `#165`
  - bridge run: `33346664018`
  - execution/postcheck: `success`
- `20260831210000_trusted_allocation_receipts.sql`
  - approved main: `047871f25d6c2348e846448dcc1306e6f01fe0d2`
  - ledger: issue `#165`
  - bridge run: `33498574140`
  - `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_EXECUTED`: `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`
- `20260901130000_harden_pv_counting.sql`
  - approved main: `8bafd9fff8de53c50bb76717dc1fbb9efa59a3dc`
  - ledger: issue `#165`
  - bridge run: `33526794913`
  - `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_EXECUTED`: `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`
- `20260902143000_beta_standard_free_entitlement.sql`
  - approved main: `3ad58fc878ac5ce7880ee2e55d946ffbe8a8fbfe`
  - ledger: issue `#165`
  - bridge run: `33610652517`
  - `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_EXECUTED`: `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`

The later migrations establish trusted allocation receipts, server-authoritative PV counting, and the beta-free Standard entitlement required by the current product state. They are already applied and postchecked; this reconciliation does not repeat any Production migration.

## Backup / restore — PASS / CURRENT

Historical hard-gate evidence remains valid:

- Production Supabase Pro scheduled backups enabled;
- 7-day scheduled-backup retention observed;
- pre-release recovery point existed;
- `docs/BACKUP-RESTORE-RUNBOOK.md` reviewed;
- non-production restore rehearsal succeeded against a disposable project;
- restored novels, episodes, profiles, and auth users were observed;
- disposable restore project deleted and Production remained healthy;
- PITR intentionally remains disabled for the beta recovery posture.

Newest accepted read-only backup evidence remains:

- Workflow: `NOVELIGHT Production Backup Freshness`
- Run: `33354249864` (#8)
- Head: `79e33341c90779270dfb7ebedec7ad2d34d3e32f`
- Conclusion: `success`
- Job `Verify latest Production backup is fresh`: `success`

The compare from that backup-freshness head through current main does not modify the backup workflow, backup-freshness script, or Production backup control path. Therefore #8 remains the current read-only backup freshness proof; no manual rerun is performed only for documentary freshness.

## Content / moderation / ADMIN — PASS / CURRENT VIA COMBINED EVIDENCE

Still-valid behavioral evidence covers AI-use classification, mature-content warnings, controlled-beta prohibited-content rules, report submission into `content_reports`, raw-report privacy, and the operator routine in `docs/BETA-OPERATIONS-RUNBOOK.md`.

ADMIN v1 remains read-only and protected by server-side bearer-token verification plus a server-side allowlist, with fail-closed behavior for missing/malformed allowlist configuration and denial of non-admin authenticated callers before data loaders run.

Production ADMIN allowlist state was subsequently established through the dedicated approval boundary:

- request issue: `#271`, closed `completed`;
- approved main: `43b25b2d337384af2611f0424c71a05800b75542`;
- OWNER approval: exact request/SHA/fingerprint;
- apply run: `33402197728`;
- ledger: `CLAIMED` -> `CONSUMED`, `result="success"`;
- Production env update and deployment ID were recorded without exposing the allowlist value.

Later login hardening and current exact-main CI/CodeQL/Vercel do not weaken this operator boundary. Production Authenticated Smoke #312 is not claimed to test ADMIN authorization; it proves the end-user beta-critical scope described below.

## Discovery / LIGHT ANALYTICS — PASS / CURRENT VIA COMBINED EVIDENCE

Still-valid product evidence covers Free initial exposure, Free/Standard/Premium general-feed inclusion, Standard `home_plan_extra`, separate Premium dedicated exposure, search impression recording, impression -> detail CTR, detail -> episode 1 rate, episode 1 -> episode 2 rate, and plan-added impression counts.

Post-8/31 hardening now also forms part of the current Production state:

- trusted allocation receipts are enforced by `20260831210000_trusted_allocation_receipts.sql`;
- server-authoritative PV counting is enforced by `20260901130000_harden_pv_counting.sql`;
- both Production migrations were OWNER-approved, executed, and postchecked successfully;
- the fresh Production authenticated smoke on current main exercised trusted allocation/reader engagement flows successfully on Desktop and Mobile.

The pricing changes do not redefine the MASTER principle that paid plans buy discovery opportunity rather than ranking/evaluation outcomes.

## Beta-start data — PASS / CURRENT VIA COMBINED EVIDENCE

Current/still-valid evidence covers:

- X `utm_source=x` acquisition touch;
- first-touch acquisition claim on registration/login;
- daily revisit/lifecycle activity without raw visitor-token storage;
- direct/X detail and episode events independent of internal discovery attribution;
- concurrency-safe Founding Author #001–#100 assignment;
- Stripe webhook idempotent subscription event history.

The later login change prevents optional telemetry rejection from blocking successful redirects; current exact-main browser CI and the fresh Production authenticated smoke both pass after that change.

## Production beta billing / Stripe / Vercel — PASS / CURRENT

PR #307 (`3ad58fc878ac5ce7880ee2e55d946ffbe8a8fbfe`) changed the beta billing contract to:

- Standard: beta period `0円`, credit card not required;
- Premium: beta special price `月額480円`;
- Premium regular/formal price remains `月額1,980円`;
- beta-end price-transition conditions are announced in advance.

Production application of that contract completed successfully in:

- Workflow: `NOVELIGHT Stripe Production Bootstrap`
- Run: `33612120034` (#7)
- Head: `3ad58fc878ac5ce7880ee2e55d946ffbe8a8fbfe`
- Event: `workflow_dispatch`
- Conclusion: `success`
- Job: `Provision Stripe live billing and sync Vercel`: `success`

Successful job steps include:

- provision/verify Stripe live beta objects;
- sync Production variables to Vercel;
- verify Production variable names;
- trigger Production redeploy with beta-pricing variables;
- wait for Production beta billing API routes;
- transition existing live subscriptions to beta pricing;
- remove superseded/verified legacy webhook endpoints;
- run no-charge Production beta billing control proof;
- audit final Production billing consistency.

This run supersedes the older run `33065836764` as the decisive current Production billing/webhook proof for the changed beta-pricing boundary. The old proof remains historical evidence only; it is not relabeled current after the webhook/billing changes in PR #307.

No Stripe live bootstrap, Vercel env sync/redeploy, or billing migration is repeated by this reconciliation.

## Production authenticated beta-critical path — PASS / EXACT CURRENT MAIN

Newest decisive Production authenticated proof:

- Request issue: `#312`, closed `completed`.
- Workflow: `NOVELIGHT Production Auth Smoke Approval Handler`.
- Run: `33640915840` (#358).
- Event: `issue_comment`.
- Exact approved/head SHA: `cdd04a0ec0abfe3eb4c1ff81325e00d7d6bfc5b3`.
- Run conclusion: `success`.
- Decisive job `Verify authenticated beta-critical production flows`: `success`.
- OWNER approval: exact request/SHA verified.
- Approval ledger: exact request/SHA -> `CLAIMED` with run `33640915840` -> `CONSUMED`, `result="success"`; issue closed completed.
- Desktop authenticated smoke: `pass`.
- Mobile authenticated smoke: `pass`.
- Ephemeral Production smoke-data cleanup: `success`.
- Temporary credential/fixture cleanup: `success`.

The current smoke runs after PR #307's beta-pricing implementation and PR #311's smoke-contract alignment. The passed current test contract validates cardless beta Standard activation and Premium Checkout on separate users without charging while preserving the broader authenticated author/reader flow.

This exact-current proof supersedes Production Authenticated Smoke #163 for launch reliance on the beta-critical author/reader scope. #163 remains historical evidence only.

Do **not** repeat Issue #312 / run `33640915840` merely for a newer timestamp or to refresh this document. It is current for the exact material main proved here. A later material change must refresh only the affected scope under the Evidence Freshness Gate.

## Production public/legal/read-only surfaces — PASS / CURRENT VIA COMBINED EVIDENCE

Public release surfaces still include Terms, Privacy, Content Guidelines, Billing Policy, Commerce Disclosure, Contact, pricing, login/signup, reader, and discovery pages.

PR #307 materially changed pricing/billing disclosures, so Production Readiness #58 on `c00bf121...` is retained only as historical/still-valid route/read-only baseline evidence and is **not** described as exact-current content proof.

Current evidence for the changed public/billing/auth surface is instead combined from:

- exact-current `NOVELIGHT CI` #1367 / run `33640026505`: success;
- exact-current `CodeQL` #1298 / run `33640026461`: success;
- exact-current Vercel commit status: success;
- Stripe Production Bootstrap #7 / run `33612120034`: Production beta-pricing env sync/redeploy, route wait, no-charge control, and final billing audit all success;
- fresh exact-current Production Auth Smoke Issue #312 / run `33640915840`: Production page convergence, Desktop/Mobile authenticated beta-critical flows, and cleanup success.

This is an engineering/reachability/billing observation, not legal advice. Qualified counsel review remains deferred/pending.

## Legal / brand status — GO RECORDED WITH DEFERRED COUNSEL REVIEW

`docs/legal-beta-review.md` records:

- Qualified Japanese counsel review: **DEFERRED BY OWNER / STILL PENDING**.
- Explicit owner residual-risk decision: **RECORDED 2026-08-28**.
- Controlled public-beta GO: **RECORDED 2026-08-28**.
- The GO and residual-risk decision do not establish legal sufficiency or waive mandatory law, regulator, payment-provider, hosting/platform, or other applicable requirements.

## Checklist reconciliation

`docs/BETA-RELEASE-CHECKLIST.md` is reconciled in parallel with this rolling index.

An `[x]` means the scope is supported by current or specifically justified still-valid evidence under the Evidence Freshness Gate. It does not imply every external operation was repeated on current main.

No current-main CI `success` is used to imply that a selectively skipped job ran. No already-current Production mutation is repeated for documentary freshness.

## Current release state

**Controlled public-beta: GO — CURRENT LAUNCH POSTURE RECONCILED 2026-09-02.**

Current material launch main at reconciliation: `cdd04a0ec0abfe3eb4c1ff81325e00d7d6bfc5b3`.

Current exact-main repository evidence: CI #1367 / run `33640026505`, CodeQL #1298 / run `33640026461`, Vercel success.

Current decisive Production authenticated proof: Issue #312 / run `33640915840` on exact current main, with exact OWNER approval, `CLAIMED`, `CONSUMED result="success"`, Desktop/Mobile PASS, and cleanup success.

Current Production billing proof: Stripe Production Bootstrap #7 / run `33612120034` on PR #307 material billing head, including beta pricing transition, Vercel Production sync/redeploy, no-charge control, and final billing audit success.

Current Production database state includes the five listed post-GO migrations through `20260902143000`, all already OWNER-approved/applied/postchecked successfully.

Qualified counsel review remains an explicit deferred item and must not be silently converted to `completed`.

This reconciliation authorizes **no** Production DB/RLS mutation, Stripe live mutation, Secret/env change, Vercel Production redeploy, manual Production workflow rerun, or destructive/high-impact operation. Existing approval boundaries remain in force.

If this reconciliation advances `main` only by updating release documentation and the MASTER pricing record, the evidence classifications above remain valid because those changes do not alter the proved runtime boundaries. If a later material product, Production, billing, auth, database/RLS, security, legal/public-surface, backup, or release-control change lands before or during beta launch, refresh only the affected scope under `docs/EVIDENCE-FRESHNESS-GATE.md` before relying on the recorded GO.
