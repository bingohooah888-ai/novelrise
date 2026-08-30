# NOVELIGHT public-beta release checklist

This checklist is the final operational gate after code review/CI. A checked box must represent an observed result, not an assumption.

**Reconciled: 2026-08-30 JST for pre-beta current-state reconciliation.**

Historical GO decision baseline: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1`.

Current audited behavioral evidence baseline: `dbf0c5418262c8cec059c8b48cac3158a5e962ac`.

Under `docs/EVIDENCE-FRESHNESS-GATE.md`, `[x]` means the scope is supported by current or still-valid decisive evidence. It does not mean every external operation was repeated on the current audited main. Existing current Production proofs must not be re-run merely for documentary freshness.

Qualified Japanese counsel review is **deferred/pending**, not completed. The owner residual-risk decision and deferred status are recorded in `docs/legal-beta-review.md`; checking the legal-status item below does not assert legal sufficiency.

**Controlled public-beta GO: RECORDED 2026-08-28; CURRENT LAUNCH POSTURE RECONCILED 2026-08-30.** See `docs/BETA-RELEASE-DECISION-2026-08-28.md` and `docs/BETA-RELEASE-EVIDENCE-LATEST.md`.

## Git / CI

- [x] Release evidence was reconciled against the latest approved `main` and the current `docs/NOVELIGHT-MASTER.md`.
- [x] Required Node/format/lint/dependency gates pass or retain still-valid applicable evidence under the freshness gate.
- [x] RLS/integration tests pass through the latest beta migrations with no later material schema/RLS invalidation.
- [x] Desktop + mobile Playwright gates pass on the current audited main for the relevant product flows.
- [x] Current-main CodeQL analysis passed.
- [x] Current-main Vercel deployment status is successful.
- [x] No user-facing `NovelRise`/`NOVELRISE`/`novelrise` remains in root HTML under the current Production Readiness proof.

Current decisive Git/deploy evidence:

- `NOVELIGHT CI` #1048 / run `33291158047` / head `dbf0c5418262c8cec059c8b48cac3158a5e962ac`: `success`.
- `CodeQL` #980 / run `33291157993` / same head: `success`.
- Vercel commit status for the same head: `success`.
- `NOVELIGHT Production Readiness Smoke` #54 / run `33291158004` / same head: `success`.

## Supabase production

- [x] `status` / `dry-run` showed only the migrations intended for the beta release sequence.
- [x] New beta migrations were deployed in timestamp order.
- [x] Postchecks passed after deployment.
- [x] Password recovery redirect URL for the production origin's `/reset-password.html` is allowed in Supabase Auth redirect configuration.
- [x] Signup confirmation redirect for the production origin is allowed.
- [x] A controlled password-reset end-to-end test succeeded: email -> reset page -> new password -> new login.
- [x] No later Production Supabase schema/RLS/migration/auth-configuration change was identified that invalidates those completed Production proofs; later auth UI changes are covered by current-main regression/Production Auth evidence.

## Backup / restore — hard GO gate

- [x] Production Supabase automatic backup capability was verified in the actual project; beta recovery posture is Pro scheduled backups rather than PITR.
- [x] Recovery window and 7-day scheduled-backup retention were recorded.
- [x] A sufficiently recent recovery point remains accepted under the hard gate; automated read-only `NOVELIGHT Production Backup Freshness` #3 / run `33274407623` passed, observing backup `2026-08-28T21:03:40.759Z` at `23.74h` old against a `36h` limit with 7 completed backups returned.
- [x] The compare from backup-freshness head `b3f43d2610ccc043354bfb819cca306ea671890a` to the current audited main does not change the backup workflow, freshness script, or Production backup control path.
- [x] `docs/BACKUP-RESTORE-RUNBOOK.md` was reviewed.
- [x] Non-production restore rehearsal completed and was recorded without a destructive Production restore.

## Content / moderation

- [x] New published work requires AI-use classification.
- [x] Mature work requires one or more content warnings.
- [x] Mature direct episode URL shows a warning gate.
- [x] Prohibited sexually explicit/pornographic beta rule is visible before publishing.
- [x] Novel report submission reaches `content_reports`.
- [x] Episode report submission reaches `content_reports`.
- [x] Raw report rows are not readable by anon/authenticated clients.
- [x] Operator has a documented routine to inspect new reports/support inquiries during the controlled beta.

## Discovery / LIGHT ANALYTICS

- [x] A new Free work can be selected by the initial-exposure priority when discovery traffic exists.
- [x] General feed still includes Free / Standard / Premium.
- [x] Standard plan-only exposure records `home_plan_extra`.
- [x] Premium dedicated exposure remains separate from the general feed.
- [x] Search recommended, new, PV and favorite sorts all record visible impressions.
- [x] LIGHT ANALYTICS shows impression -> detail CTR.
- [x] LIGHT ANALYTICS shows detail -> episode 1 rate.
- [x] LIGHT ANALYTICS shows episode 1 -> episode 2 rate.
- [x] Standard/Premium plan-added impressions can be read as actual recorded counts.
- [x] Later navigation/favorites/auth hardening is covered by current-main CI and Production Auth smoke; no later material discovery-selection/analytics-pipeline invalidation was identified.

## Beta-start data

- [x] X test URL with `utm_source=x` records an acquisition touch.
- [x] Registration/login claims first-touch acquisition to the signed-in user.
- [x] Daily revisit ledger records expected activity without raw visitor token storage.
- [x] Direct/X detail and episode events persist independently of internal discovery attribution.
- [x] First qualifying authors receive concurrency-safe Founding Author #001–#100 records.
- [x] Verified Stripe webhook writes idempotent subscription event history.

## Legal / brand

- [x] Terms, privacy, content guidelines, billing policy, commerce disclosure and contact are reachable from public navigation/footer surfaces.
- [x] Content guidelines describe the live report route in present tense.
- [x] Privacy policy describes UTM/acquisition, pseudonymous visit/activity and analytics processing actually used in beta.
- [x] Current Production Readiness #54 passed on the audited main for the public/legal/read-only surface scope.
- [x] Final Japanese legal review status has been recorded; counsel review is deferred/pending and the accepted owner residual risk is explicit.

## Final smoke

- [x] Signup
- [x] Login
- [x] Password recovery
- [x] Search
- [x] Novel detail
- [x] Episode reading
- [x] Novel posting
- [x] Episode posting
- [x] Favorite
- [x] LIGHT SEED
- [x] SCOUT RECORD
- [x] LIGHT ANALYTICS
- [x] Pricing/checkout test mode or approved controlled production check
- [x] Billing portal/cancel flow

Current authenticated Production refresh:

- `NOVELIGHT Production Authenticated Smoke` #109 / run `33291747746`.
- Exact approved/current main: `dbf0c5418262c8cec059c8b48cac3158a5e962ac`.
- Approval ledger: issue #242, exact OWNER approval -> `CLAIMED` -> `CONSUMED`, `result="success"`, issue closed completed.
- Approved-main re-check, authenticated browser smoke, ephemeral data cleanup, and temporary-fixture cleanup all succeeded.
- This current proof must not be repeated merely for a newer timestamp.

## Production billing proof

- [x] Existing external Stripe webhook proof run `33065836764` remains accepted current for its scoped no-charge live delivery/entitlement/cancellation/final-audit contract.
- [x] No later material change to `api/stripe-webhook.js`, the decisive webhook-handler boundary, endpoint/signing-secret state, Production Supabase target, or proof implementation was identified.
- [x] The live proof was not re-run for documentary freshness.

## Final release decision

- [x] Latest `main` and authoritative release rules were re-fetched before this reconciliation.
- [x] The change since the historical GO decision baseline was checked for material invalidation; material product/auth/control changes existed, so affected older evidence was not accepted merely because it had previously passed.
- [x] Affected current scopes were refreshed by exact/current evidence: CI #1048, CodeQL #980, Vercel success, Production Readiness #54, and Production Authenticated Smoke #109 on `dbf0c5418262c8cec059c8b48cac3158a5e962ac`.
- [x] Backup hard-gate evidence was refreshed/revalidated with read-only Backup Freshness #3 and later backup-control-path compare.
- [x] Existing Production external Stripe webhook evidence was freshness-checked and remained current without duplicate live execution.
- [x] No newly unknown non-deferred hard gate was identified.
- [x] No open `[OPS] NOVELIGHT beta inbox needs review` issue was identified during this reconciliation.
- [x] Qualified Japanese counsel review remains explicitly deferred/pending rather than being represented as completed.
- [x] Controlled public-beta GO remains recorded in `docs/BETA-RELEASE-DECISION-2026-08-28.md`.

## Reconciliation result

All non-deferred hard-gate scopes above have current or still-valid decisive evidence under `docs/EVIDENCE-FRESHNESS-GATE.md` for the current launch posture.

Qualified Japanese counsel review remains explicitly deferred/pending and is not represented as completed or as proof of legal compliance.

**Controlled public-beta GO: CURRENT LAUNCH POSTURE RECONCILED 2026-08-30.**

Current audited behavioral evidence baseline: `dbf0c5418262c8cec059c8b48cac3158a5e962ac`.

The GO record/reconciliation does not authorize unrelated Production/Secret/Stripe live/Supabase Production/Vercel Production mutations. If this reconciliation itself advances `main` only through release-documentation changes, the behavioral evidence remains current. If a later material change alters the launch state before or during actual beta opening, refresh only the affected scope before relying on the recorded GO.