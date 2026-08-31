# NOVELIGHT β Release Evidence — Latest Reconciled State

**Reconciled: 2026-08-31 JST**

This file is the rolling current-state index required by `docs/EVIDENCE-FRESHNESS-GATE.md`. Dated `BETA-RELEASE-EVIDENCE-*.md` files remain historical snapshots and are not rewritten. Newer same-scope workflow, approval-ledger, compare, or read-only live evidence supersedes older descriptive status when no later material change invalidates the proof.

## Release decision

**Controlled public-beta GO: RECORDED 2026-08-28; CURRENT LAUNCH POSTURE RECONCILED 2026-08-31.**

Decision record: `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

Historical decision baseline main: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1` (`Reconcile beta release evidence closure (#198)`).

Current launch main at this reconciliation: `c00bf121ae261e4eca26cb7e05cfb8abb3cfbbdd` (`Add secure NOVELIGHT ADMIN dashboard (#265)`).

The GO decision remains historical and is not rewritten. Material product/auth/billing/database/release-control changes landed after the historical decision baseline, so older GO-era proof is never accepted merely because it once passed. Affected scopes are classified under `docs/EVIDENCE-FRESHNESS-GATE.md` as current, still-valid for a narrower unchanged scope, or refresh-required.

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING** with owner residual risk recorded in `docs/legal-beta-review.md`. This GO is an operational release decision, not a finding of legal sufficiency.

## Git / CI — PASS / CURRENT

Exact current-main evidence:

- `NOVELIGHT CI` #1196 / run `33368084498` / head `c00bf121ae261e4eca26cb7e05cfb8abb3cfbbdd`: `success`.
- Required aggregate `check`: `success`.
- Node tests: `success`.
- Static quality: `success`.
- Desktop smoke: `success`.
- Mobile smoke: `success`.
- Desktop async-UI browser regression: `success`.
- Mobile async-UI browser regression: `success`.
- `CodeQL` #1128 / run `33368084384` / same head: `success`.
- Vercel commit status for the same head: `success` (`Deployment has completed`).
- `NOVELIGHT Production Readiness Smoke` #58 / run `33368084397` / same head: `success`.

The current-main CI classifier skipped RLS integration/rollback, dependency vulnerability audit, and GitHub Actions semantic lint because the #265 merge did not change the file classes that trigger those jobs. This reconciliation does **not** represent those skipped jobs as having run on `c00bf121...`; their unaffected prior evidence is reused only where the freshness gate permits it.

Production Readiness #58 separately verified Production static-route convergence, safe API route contracts, read-only Production reader behavior, and Production beta observability on the exact current main.

## Supabase Production — PASS / CURRENT VIA HISTORICAL + POST-GO LEDGER EVIDENCE

Earlier Production migration/auth evidence remains recorded in `docs/BETA-RELEASE-EVIDENCE-2026-08-23.md` and related dated evidence.

Two later Production migrations landed after the 2026-08-30 reconciliation and are now part of the current Production state:

- `20260830163000_atomic_episode_publish.sql`
  - approved main: `e43e8b9003b7bad5ab0b2b84b8b20b00b31e8501`
  - central approval ledger: issue `#165`
  - claimed bridge run: `33307362222`
  - execution: `success`
  - mutation result: `success`
  - postcheck result: `success`
  - failure phase: `none`
- `20260830214000_checkout_attempt_reservations.sql`
  - approved main: `79e33341c90779270dfb7ebedec7ad2d34d3e32f`
  - central approval ledger: issue `#165`
  - claimed bridge run: `33346664018`
  - execution: `success`
  - mutation result: `success`
  - postcheck result: `success`
  - failure phase: `none`

The first migration makes episode creation plus first novel publication one database transaction. The second adds server-only checkout-attempt reservation state used to serialize initial Stripe Checkout creation. Both were already applied and postchecked successfully before this reconciliation; this document update does not repeat either Production mutation.

PR #265 adds the read-only operator ADMIN surface and does **not** add a Supabase migration, Production DB write path, Stripe mutation, or committed secret.

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

Fresh read-only evidence:

- Workflow: `NOVELIGHT Production Backup Freshness`
- Run: `33354249864` (#8)
- Head: `79e33341c90779270dfb7ebedec7ad2d34d3e32f`
- Conclusion: `success`
- Job `Verify latest Production backup is fresh`: `success`

The compare from that backup-freshness head through `c00bf121...` does not modify the backup workflow, backup-freshness script, or Production backup control path. Therefore #8 is the current read-only backup freshness proof; no manual rerun is performed for documentary freshness.

## Content / moderation — PASS / CURRENT VIA COMBINED EVIDENCE

Still-valid behavioral evidence covers:

- AI-use classification on publication;
- mature-content warnings and direct-episode warning gate;
- controlled-beta sexually explicit/pornographic prohibition;
- novel/episode report submission into `content_reports`;
- raw report rows unreadable by ordinary anon/authenticated clients;
- controlled-beta operator routine in `docs/BETA-OPERATIONS-RUNBOOK.md`.

The new ADMIN v1 surface is read-only and was designed to expose only minimized operator data. PR #265 requires server-side bearer-token verification plus a server-side allowlist before operator data is returned; malformed/missing allowlist configuration fails closed, non-admin authenticated users receive 403 before data loaders run, and the API is GET-only with private/no-store caching. Current-main CI, CodeQL, and Production Readiness safe-API checks passed after the merge.

At the 2026-08-31 reconciliation, no open issue titled `[OPS] NOVELIGHT beta inbox needs review` was found.

## Discovery / LIGHT ANALYTICS — PASS / CURRENT VIA COMBINED EVIDENCE

Still-valid evidence covers:

- Free initial exposure;
- Free / Standard / Premium general-feed inclusion;
- Standard `home_plan_extra` exposure;
- separate Premium dedicated exposure;
- search impression recording across recommended/new/PV/favorite sorts;
- impression -> detail CTR;
- detail -> episode 1 rate;
- episode 1 -> episode 2 rate;
- actual recorded plan-added impression counts.

The current-main changes in PR #265 do not alter discovery selection or the reader analytics pipeline. Current-main CI/CodeQL and Production Readiness provide current regression reinforcement without a new Production mutation.

## Beta-start data — PASS / CURRENT VIA COMBINED EVIDENCE

Current/still-valid evidence covers:

- X `utm_source=x` acquisition touch;
- first-touch acquisition claim on registration/login;
- daily revisit/lifecycle activity without raw visitor-token storage;
- direct/X detail and episode events independent of internal discovery attribution;
- concurrency-safe Founding Author #001–#100 assignment;
- Stripe webhook idempotent subscription event history.

PR #265 changes the login redirect allowlist only to permit the same-origin `/admin.html` destination. Existing sign-in/session logic and existing author/reader redirect destinations are unchanged.

## Authenticated Staging lifecycle proof — PASS / HISTORICAL, STILL VALID WHERE UNAFFECTED

Accepted lifecycle proof:

- Workflow: `NOVELIGHT Staging Smoke`
- Run: `33135672826` (#98)
- Reviewed implementation baseline: `0ba72358b5213ff409aed2fca24e3af7bf1ff025`
- Conclusion: `success`

The run covers authentication, published content, favorite, LIGHT SEED, SCOUT RECORD, LIGHT ANALYTICS, isolated Stripe test Checkout, entitlement reconciliation, Billing Portal, cancellation, and cleanup.

Later product/auth/database changes mean this historical Staging run is not used by itself to claim currentness for every current behavior. Its unaffected lifecycle/billing evidence remains useful alongside newer current-main CI/CodeQL, later migration ledgers, and the Production authenticated proof below.

## Production authenticated author/reader path — PASS / STILL CURRENT FOR THE PROVED SCOPE

Newest decisive Production authenticated proof for the existing beta-critical author/reader flow:

- Workflow: `NOVELIGHT Production Authenticated Smoke`
- Run: `33362071374` (#163)
- Approved main: `d2b21f647e67104cf40476685b86afac274222ce`
- Request/approval ledger: issue `#263`
- Conclusion: `success`
- OWNER approval: verified for the exact request/SHA
- Approval ledger: exact request/SHA -> `CLAIMED` with run `33362071374` -> `CONSUMED`, `result="success"`; issue closed completed
- Immediate approved-main re-check before Production write: `success`
- Production beta-critical pages converged to the approved main before the write: `success`
- Authenticated browser smoke: `success`
- Ephemeral Production smoke-data cleanup: `success`
- Temporary credential/fixture cleanup: `success`

The smoke covered the existing end-user beta-critical path, including author login, work creation, episode publication, reader login, favorite, LIGHT SEED, SCOUT RECORD, reader engagement/LIGHT ANALYTICS, no-charge Checkout-session creation, and deletion/cleanup.

Freshness classification after PR #265: **still current for that pre-existing author/reader scope**. The compare from `d2b21f...` to current main `c00bf121...` adds a read-only operator ADMIN surface and adds `/admin.html` to the existing same-origin login redirect allowlist; it does not change the existing sign-in/session logic, existing author/reader destinations, user-facing billing flow, Supabase auth configuration, or user DB/RLS schema.

Production Authenticated Smoke #163 is **not** claimed to prove the new operator authorization boundary. That new ADMIN boundary is separately supported by PR #265's exact-head High-Risk OWNER approval, current-main CI #1196, CodeQL #1128, Vercel success, and Production Readiness #58 safe-API/read-only checks.

Do **not** repeat Production Authenticated Smoke #163 merely for a newer timestamp or to refresh this document. Any future material change to the existing beta-critical authenticated flow must be classified under the Evidence Freshness Gate and, if required, use a new separately approved Production smoke request.

## Production external Stripe webhook delivery — PASS / CURRENT

Decisive proof:

- Workflow: `NOVELIGHT Chat-Mediated Production Approval`
- Run: `33065836764`
- Proof SHA: `944c2232a577ebeae32798c29a508b8540a26807`
- Conclusion: `success`
- Approval ledger: issue `#165`, request consumed successfully
- Completion contract: no-charge external webhook proof plus zero final billing-audit issues

Scoped proof:

`Stripe Live event creation without artificial paid charge -> Production Vercel webhook -> Production Supabase entitlement/cancellation reflection -> final billing audit`.

No later material change to `api/stripe-webhook.js`, the decisive webhook-handler boundary, endpoint/signing-secret state, or Production Supabase target has been identified. The later checkout-concurrency migration changes initial Checkout reservation, not external webhook delivery. The webhook proof remains `current`; duplicate execution of the same Production mutation is prohibited.

## Production public/legal/read-only surfaces — PASS / CURRENT

Exact current-main read-only observation:

- Workflow: `NOVELIGHT Production Readiness Smoke`
- Run: `33368084397` (#58)
- Head: `c00bf121ae261e4eca26cb7e05cfb8abb3cfbbdd`
- Conclusion: `success`
- Production static routes: `success`
- Safe API route contracts: `success`
- Read-only Production reader smoke: `success`
- Production beta observability: `success`

This supersedes older Production Readiness entries for current launch reliance. It is an engineering/read-only reachability observation, not legal advice.

## Legal / brand status — GO RECORDED WITH DEFERRED COUNSEL REVIEW

`docs/legal-beta-review.md` records:

- Qualified Japanese counsel review: **DEFERRED BY OWNER / STILL PENDING**.
- Explicit owner residual-risk decision: **RECORDED 2026-08-28**.
- Controlled public-beta GO: **RECORDED 2026-08-28**.
- The GO and residual-risk decision do not establish legal sufficiency or waive mandatory law, regulator, payment-provider, hosting/platform, or other applicable requirements.

## Checklist reconciliation

`docs/BETA-RELEASE-CHECKLIST.md` is reconciled in parallel with this rolling index.

An `[x]` means the scope is supported by current or specifically justified still-valid evidence under the Evidence Freshness Gate. It does not imply every external operation was repeated on the current main.

No current-main CI `success` is used to imply that a selectively skipped job ran. No already-current Production mutation is repeated for documentary freshness.

## Current release state

**Controlled public-beta: GO — CURRENT LAUNCH POSTURE RECONCILED 2026-08-31.**

Current launch main at reconciliation: `c00bf121ae261e4eca26cb7e05cfb8abb3cfbbdd`.

Current exact-main regression/read-only evidence: CI #1196, CodeQL #1128, Vercel success, Production Readiness #58.

Current/still-valid Production authenticated author/reader proof: Production Authenticated Smoke #163 / run `33362071374` on `d2b21f...`, with freshness narrowed to the unchanged pre-existing author/reader scope after PR #265.

Qualified counsel review remains an explicit deferred item and must not be silently converted to `completed`.

This reconciliation authorizes **no** Production DB/RLS mutation, Stripe live mutation, Secret/env change, manual Production workflow rerun, or unrelated Vercel Production state change. Existing approval boundaries remain in force.

If this reconciliation advances `main` only by updating release documentation, the evidence classifications above remain valid. If a later material product, Production, billing, auth, database/RLS, security, legal/public-surface, backup, or release-control change lands before or during beta launch, refresh only the affected scope under `docs/EVIDENCE-FRESHNESS-GATE.md` before relying on the recorded GO.