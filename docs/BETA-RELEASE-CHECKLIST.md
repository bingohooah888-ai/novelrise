# NOVELIGHT public-beta release checklist

This checklist is the final operational gate after code review/CI. A checked box must represent an observed result, not an assumption.

**Reconciled: 2026-08-28 JST against main `97a67fc423c6be79280c861a2a3d5659877b351f`.**

Under `docs/EVIDENCE-FRESHNESS-GATE.md`, `[x]` means the scope is supported by current or still-valid decisive evidence. It does not mean every external operation was repeated on this exact SHA. Existing current Production proofs must not be re-run merely for documentary freshness.

Qualified Japanese counsel review is **deferred/pending**, not completed. The owner residual-risk decision and the deferred status are recorded in `docs/legal-beta-review.md`; checking the legal-status item below does not assert legal sufficiency.

Controlled public-beta GO is **not yet recorded** and remains a separate explicit final release decision.

## Git / CI

- [x] PR/release candidate is based on the latest approved `main` and the current `docs/NOVELIGHT-MASTER.md`.
- [x] Required Node/format/lint/dependency gates pass or retain still-valid applicable evidence under the freshness gate.
- [x] RLS/integration tests pass through the latest beta migrations with no later material schema/RLS invalidation.
- [x] Desktop + mobile Playwright gates pass and no later material product change invalidates them.
- [x] No user-facing `NovelRise`/`NOVELRISE`/`novelrise` remains in root HTML.

## Supabase production

- [x] `status` / `dry-run` showed only the migrations intended for the beta release sequence.
- [x] New beta migrations were deployed in timestamp order.
- [x] Postchecks passed after deployment.
- [x] Password recovery redirect URL for the production origin's `/reset-password.html` is allowed in Supabase Auth redirect configuration.
- [x] Signup confirmation redirect for the production origin is allowed.
- [x] A controlled password-reset end-to-end test succeeded: email -> reset page -> new password -> new login.

## Backup / restore — hard GO gate

- [x] Production Supabase automatic backup capability was verified in the actual project; beta recovery posture is Pro scheduled backups rather than PITR.
- [x] Recovery window and 7-day scheduled-backup retention were recorded.
- [x] A sufficiently recent recovery point exists before the final release decision; automated read-only freshness run `33172222421` passed on current main.
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

## Reconciliation result

All non-deferred hard-gate scopes above have current or still-valid evidence under `docs/EVIDENCE-FRESHNESS-GATE.md`. No newly unknown non-deferred hard item was identified at this reconciliation.

Qualified Japanese counsel review remains explicitly deferred/pending and is not represented as completed or as proof of legal compliance.

**Controlled public-beta GO remains NOT YET RECORDED.** Record GO only as a separate explicit release decision after re-fetching the then-current `main` and confirming that no material change has invalidated any scope above.