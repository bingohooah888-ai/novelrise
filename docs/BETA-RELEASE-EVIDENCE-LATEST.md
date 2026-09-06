# NOVELIGHT β Release Evidence — Latest Reconciled State

**Reconciled: 2026-09-06 JST**

This file is the rolling current-state index required by `docs/EVIDENCE-FRESHNESS-GATE.md`. Dated `BETA-RELEASE-EVIDENCE-*.md` files remain historical snapshots and are not rewritten. Newer same-scope workflow, approval-ledger, compare, or read-only live evidence supersedes older descriptive status when no later material change invalidates the proof.

## Release decision

**Controlled public-beta GO: RECORDED 2026-08-28; CURRENT LAUNCH POSTURE RECONCILED 2026-09-06.**

Decision record: `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Historical decision baseline main: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1` (`Reconcile beta release evidence closure (#198)`).

Current material launch main at this reconciliation: `5a5b502c61d984bf7d0329ea59a8d99b55b05861` (`Cover author home in Production Auth Smoke (#391)`).

The GO decision remains historical and is not rewritten. Material author-home/profile/avatar/activity changes landed in PR #390, followed by PR #391 adding the affected author-home scope to the approval-gated Production Authenticated Smoke. Older proof is reused only for unchanged scopes; affected scopes are refreshed below with current CI/CodeQL/Vercel, the latest deploy-relevant Production Readiness proof, Production migration-ledger evidence, and exact-current Production Authenticated Smoke evidence.

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING** with owner residual risk recorded in `docs/legal-beta-review.md`. This GO is an operational release decision, not a finding of legal sufficiency.

## Git / CI — PASS / EXACT CURRENT MAIN

Exact current-main evidence for `5a5b502c61d984bf7d0329ea59a8d99b55b05861`:

- `NOVELIGHT CI` #1677 / run `34025120957`: `success`.
- Required aggregate `check`: `success`.
- Node tests: `success`.
- Static quality: `success`.
- Desktop smoke: `success`.
- Mobile smoke: `success`.
- Desktop async-UI browser regression: `success`.
- Mobile async-UI browser regression: `success`.
- GitHub Actions semantic lint: `success`.
- `CodeQL` #1600 / run `34025120981`: `success`.
- Vercel commit status for the same head: `success`.

The current-main CI classifier skipped Merge Readiness preflight, RLS integration/rollback, and dependency vulnerability audit because those gates were not relevant to PR #391's changed-file classification. This reconciliation does **not** represent those skipped jobs as having run on `5a5b502c...`.

The newest deploy-relevant Production Readiness proof for the changed author-home runtime is:

- PR #390 merge head: `94d17f7d6bd096bc21091549fbb771e6dbcb471c`.
- `NOVELIGHT Production Readiness Smoke` #91 / run `34017874567`: `success`.
- The PR #390 runtime diff changed `mypage.html` plus migration/test files.
- PR #391 did not change deploy-relevant application runtime files; its changed files are the Production Auth Smoke request workflow, MASTER, smoke cleanup fixture, automation-continuation regression test, and author-home Production smoke test.

Accordingly, Production Readiness #91 remains the latest relevant read-only deployment proof for the author-home runtime, while the exact-current approval-gated Auth Smoke below refreshes the affected authenticated/write boundary on `5a5b502c...`.

## Supabase Production — PASS / CURRENT VIA APPROVAL LEDGER

Earlier Production migration/auth evidence remains recorded in dated release evidence. The rolling state includes these post-GO migrations, all executed through the Production approval ledger with mutation and postcheck success:

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
  - bridge run: `33498574140`
  - execution/postcheck: `success`
- `20260901130000_harden_pv_counting.sql`
  - approved main: `8bafd9fff8de53c50bb76717dc1fbb9efa59a3dc`
  - bridge run: `33526794913`
  - execution/postcheck: `success`
- `20260902143000_beta_standard_free_entitlement.sql`
  - approved main: `3ad58fc878ac5ce7880ee2e55d946ffbe8a8fbfe`
  - bridge run: `33610652517`
  - execution/postcheck: `success`
- `20260903010000_admin_operations_hub`
- `20260904133000_official_novel_thumbnails`
- `20260904174500_harden_official_thumbnail_function_privileges`
  - approved together on main: `c552f6357018e9f60b93da3f45ba5d2bea1b7b12`
  - ledger: issue `#165`
  - bridge run: `33947319837`
  - `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_EXECUTED`: `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`
- `20260906120000_author_profile_avatar_and_activity.sql`
  - approved main: `94d17f7d6bd096bc21091549fbb771e6dbcb471c` (PR #390 merge head)
  - ledger: issue `#165`
  - bridge run: `34018912226`
  - `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_EXECUTED`: `result="success"`, `mutation_result="success"`, `postcheck_result="success"`, `failure_phase="none"`

The 2026-09-06 migration establishes the author-home public-profile update RPC, avatar-path/storage boundary, and recent-activity RPC required by PR #390. Direct browser profile writes remain narrowed so billing/Stripe-related profile columns are not writable through the public profile update path.

All listed migrations were already applied and postchecked before this documentary reconciliation. No Production migration is repeated here.

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

No later change in this reconciliation requires a duplicate backup mutation or restore operation merely for documentary freshness.

## Content / moderation / ADMIN — PASS / CURRENT VIA COMBINED EVIDENCE

Still-valid behavioral evidence covers AI-use classification, mature-content warnings, controlled-beta prohibited-content rules, report submission into `content_reports`, raw-report privacy, and the operator routine in `docs/BETA-OPERATIONS-RUNBOOK.md`.

Production ADMIN allowlist state remains established through completed request issue `#271` / apply run `33402197728`, with exact OWNER approval and `CONSUMED result="success"` recorded without exposing the allowlist value.

The `20260903010000_admin_operations_hub` Production migration is part of current Production state and was OWNER-approved, executed, and postchecked successfully through issue `#165` / bridge run `33947319837`.

Production Authenticated Smoke #393 is not claimed to prove the ADMIN authorization boundary; it proves the end-user beta-critical scope described below.

## Discovery / LIGHT ANALYTICS / novel posting — PASS / CURRENT

Still-valid product evidence covers Free initial exposure, Free/Standard/Premium general-feed inclusion, Standard `home_plan_extra`, separate Premium dedicated exposure, search impression recording, impression -> detail CTR, detail -> episode 1 rate, episode 1 -> episode 2 rate, and plan-added impression counts.

Current Production state additionally includes:

- trusted allocation receipts enforced by `20260831210000_trusted_allocation_receipts.sql`;
- server-authoritative PV counting enforced by `20260901130000_harden_pv_counting.sql`;
- official novel-thumbnail schema and hardened thumbnail-function privileges through the 2026-09-04 migrations;
- dedicated discovery-list semantics/pagination fixes merged before current main;
- PR #368 fallback allowing novel creation when the official-thumbnail schema exists but the active official-thumbnail catalog is temporarily empty, while keeping thumbnail selection required once active assets exist and ordinary load errors fail-closed;
- PR #390 author-home profile/avatar/recent-activity runtime backed by `20260906120000_author_profile_avatar_and_activity.sql`.

The fresh exact-current Production authenticated smoke exercised the beta-critical author/reader flow after these changes. It also directly exercised the new author-home profile controls, `novelight_update_my_public_profile`, real `author-avatars` Storage upload/public rendering under the author UUID folder, and recent-activity RPC.

The MASTER principle remains unchanged: paid plans buy discovery opportunity rather than ranking/evaluation outcomes.

## Beta-start data — PASS / CURRENT VIA COMBINED EVIDENCE

Current/still-valid evidence covers:

- X `utm_source=x` acquisition touch;
- first-touch acquisition claim on registration/login;
- daily revisit/lifecycle activity without raw visitor-token storage;
- direct/X detail and episode events independent of internal discovery attribution;
- concurrency-safe Founding Author #001–#100 assignment;
- Stripe webhook idempotent subscription event history.

Current exact-main browser CI and the fresh Production authenticated smoke pass after the later login, discovery, posting, thumbnail, and author-home changes.

## Production beta billing / Stripe / Vercel — PASS / CURRENT

The current beta billing contract remains:

- Standard: beta period `0円`, credit card not required;
- Premium: beta special price `月額480円`;
- Premium regular/formal price: `月額1,980円`;
- beta-end price-transition conditions announced in advance.

Production application of that contract remains decisively proven by:

- Workflow: `NOVELIGHT Stripe Production Bootstrap`
- Run: `33612120034` (#7)
- Head: `3ad58fc878ac5ce7880ee2e55d946ffbe8a8fbfe`
- Event: `workflow_dispatch`
- Conclusion: `success`
- Job `Provision Stripe live billing and sync Vercel`: `success`

That run provisioned/verified Stripe live beta objects, synchronized Production variables to Vercel, redeployed the beta-pricing configuration, verified billing API route health, transitioned existing live subscriptions, ran the no-charge Production billing control proof, and audited final Production billing consistency.

No later merged change through `5a5b502c...` alters Stripe pricing, billing routes, entitlement pricing, or the live billing contract. No Stripe live bootstrap, Vercel env sync, billing transition, or live charge is repeated by this reconciliation.

## Production authenticated beta-critical path — PASS / EXACT CURRENT MAIN

Newest decisive Production authenticated proof:

- Request issue: `#393`, state `closed`, reason `completed`.
- Workflow: `NOVELIGHT Production Auth Smoke Approval Handler`.
- Run: `34025686074` (#520).
- Event: `issue_comment`.
- Exact approved/head SHA: `5a5b502c61d984bf7d0329ea59a8d99b55b05861`.
- Run conclusion: `success`.
- Decisive job `Verify authenticated beta-critical production flows`: `success`.
- OWNER approval: exact request/SHA/challenge verified.
- Approval ledger: exact request/SHA -> `CLAIMED` with run `34025686074` -> `CONSUMED`, `result="success"`; issue closed completed.
- Authenticated Production browser smoke: `3 passed`, `1 skipped` (the staging-only billing smoke is intentionally skipped in Production).
- Existing Desktop/Mobile beta-critical authenticated contracts: `success`.
- Author-home Production test `author home profile, avatar, and activity work in Production`: `success`.
- Ephemeral Production smoke-user/data creation: `success`.
- Ephemeral Production smoke-data cleanup, including author-avatar Storage objects: `success`.
- Temporary credential/fixture cleanup: `success`.
- Failed-request ledger path: correctly `skipped` because the claimed request succeeded.
- No Stripe live charge is created by this Production Auth Smoke.

The evidence set satisfies the exact evaluator contract in `scripts/evaluate-production-auth-smoke-evidence.mjs`: expected workflow/event, top-level success, exactly one successful decisive job, exact required head SHA, and exactly one matching GitHub Actions `NOVELIGHT_PRODUCTION_AUTH_SMOKE_CONSUMED` record with `result:"success"` and the same run ID/head SHA.

This exact-current proof supersedes Issue #369 / run `33951087810` for current beta-critical author/reader launch reliance. Issue #369 and earlier successful smoke evidence remain historical and are not relabeled current.

Do **not** repeat Issue #393 / run `34025686074` merely for a newer timestamp or to refresh this document. A later material change must refresh only the affected scope under the Evidence Freshness Gate.

## Production public/legal/read-only surfaces — PASS / CURRENT VIA COMBINED EVIDENCE

Public release surfaces still include Terms, Privacy, Content Guidelines, Billing Policy, Commerce Disclosure, Contact, pricing, login/signup, reader, author posting, author home, and discovery pages.

Current/relevant evidence includes:

- exact-current `NOVELIGHT CI` #1677 / run `34025120957`: success;
- exact-current `CodeQL` #1600 / run `34025120981`: success;
- exact-current Vercel commit status: success;
- latest deploy-relevant `NOVELIGHT Production Readiness Smoke` #91 / run `34017874567`: success on PR #390 runtime head `94d17f7d...`;
- exact-current Production Auth Smoke Issue #393 / run `34025686074`: Production page convergence, authenticated beta-critical flow, author-home profile/avatar/activity path, and cleanup success.

PR #391 did not modify deploy-relevant application runtime files, so the PR #390 Production Readiness result remains the relevant read-only public-surface proof while Issue #393 refreshes the exact-current authenticated/write boundary.

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

**Controlled public-beta: GO — CURRENT LAUNCH POSTURE RECONCILED 2026-09-06.**

Current material launch main at reconciliation: `5a5b502c61d984bf7d0329ea59a8d99b55b05861`.

Current exact-main repository evidence: CI #1677 / run `34025120957`, CodeQL #1600 / run `34025120981`, and Vercel success. The latest deploy-relevant Production Readiness proof is #91 / run `34017874567` on PR #390 runtime head `94d17f7d...`; PR #391 contains no deploy-relevant application runtime file change.

Current decisive Production authenticated proof: Issue #393 / run `34025686074` on exact current main, with exact OWNER approval, `CLAIMED`, `CONSUMED result="success"`, beta-critical Desktop/Mobile flow PASS, author-home profile/avatar/activity PASS, and cleanup success.

Current Production billing proof: Stripe Production Bootstrap #7 / run `33612120034` on the material beta-billing head; no later merged billing change invalidates it.

Current Production database state includes the earlier post-GO migrations plus `20260903010000`, `20260904133000`, `20260904174500`, and `20260906120000`, all already OWNER-approved/applied/postchecked successfully.

Qualified counsel review remains an explicit deferred item and must not be silently converted to `completed`.

This reconciliation authorizes **no** Production DB/RLS mutation, Stripe live mutation, Secret/env change, manual Production workflow rerun, destructive/high-impact operation, or unrelated Production state change. Existing approval boundaries remain in force.

If this reconciliation advances `main` only by updating these release documents, the evidence classifications above remain valid because the documents do not alter the proved runtime boundaries. Any later material product, Production, billing, auth, database/RLS, security, legal/public-surface, backup, or release-control change must refresh only its affected scope under `docs/EVIDENCE-FRESHNESS-GATE.md` before the recorded GO is relied upon.
