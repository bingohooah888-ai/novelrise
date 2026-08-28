# NOVELIGHT Controlled Public Beta Release Decision — 2026-08-28

## Decision

**GO — controlled public beta is approved to launch.**

Decision baseline main: `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1` (`Reconcile beta release evidence closure (#198)`).

This is the final operational release decision for the initial controlled public beta under the currently reviewed product, billing, authentication, moderation, backup, legal-surface, and operations configuration.

## Basis

The decision applies `docs/EVIDENCE-FRESHNESS-GATE.md` to the release state immediately before recording GO.

- `docs/BETA-RELEASE-CHECKLIST.md` has every non-deferred hard-gate scope reconciled to current or still-valid decisive evidence.
- `NOVELIGHT CI` run `33173431807` (#866) on decision baseline `1a5ca5dc5a90e4336ab5de74a21e2f2843e22bb1` completed with `success`; aggregate `check`, Node tests, and Static quality succeeded.
- Vercel commit status on the decision baseline is `success`.
- The change from the previous evidence baseline `97a67fc423c6be79280c861a2a3d5659877b351f` to the decision baseline modifies only `docs/BETA-RELEASE-CHECKLIST.md` and `docs/BETA-RELEASE-EVIDENCE-LATEST.md`; no product, auth, billing, database, legal/public HTML, security-boundary, or Production-control implementation changed.
- Production backup freshness remains current from read-only workflow run `33172222421`, which observed seven completed backups and a latest completed recovery point `2026-08-27T21:05:06.506Z` within the configured 36-hour freshness gate.
- Production public/legal-surface reachability remains current from Production Readiness Smoke run `33145249649` (#43); no later public HTML change invalidates that proof.
- Authenticated Staging product/billing lifecycle evidence remains current from Staging Smoke run `33135672826` (#98); no later public application behavior change invalidates it.
- Existing successful Production Authenticated Smoke evidence remains current for its proved scope.
- Production external Stripe webhook proof run `33065836764`, proof SHA `944c2232a577ebeae32798c29a508b8540a26807`, approval ledger issue `#165`, remains current. The same Production mutation must not be repeated merely because main advances.

No newly unknown non-deferred hard gate was identified.

## Qualified Japanese counsel review

Qualified Japanese counsel review remains **DEFERRED BY OWNER / STILL PENDING**.

The owner residual-risk decision was recorded on 2026-08-28 in `docs/legal-beta-review.md`: the initial controlled beta may launch before qualified counsel review, with the unresolved legal uncertainty explicitly accepted as a release-timing risk.

This GO decision is **not** legal advice, does **not** establish that the current legal documents or operations are legally sufficient, and does **not** waive mandatory law, regulator requirements, court orders, Stripe/payment-provider rules, hosting/platform rules, or any later identified legal requirement.

If a material legal concern becomes known, the affected feature or operation must be reassessed rather than relying on this GO record as a substitute for compliance.

## Scope and safety boundaries

This GO record authorizes the controlled public-beta release state; it does not grant blanket approval for unrelated Production mutations.

Production database changes, Stripe live mutations, Secret/environment-value changes, destructive actions, and other separately approval-gated operations continue to require their ordinary explicit approval and freshness checks.

Current Production proofs must not be duplicated for documentary freshness.

If a material product, Production, auth, billing, database/RLS, security, legal/public-surface, backup, or release-control change lands before the actual beta opening or materially changes the launch state, only the affected scope must be re-evaluated under `docs/EVIDENCE-FRESHNESS-GATE.md` before relying on this GO decision.

## Post-launch posture

During the controlled beta, continue the existing support, moderation, billing, security, backup, and incident routines. Qualified counsel review remains a post-launch deferred item and should be reconsidered using real beta usage, acquisition, operational findings, and continued-service value, without treating user traction as a substitute for legal compliance where a mandatory issue is identified.

## Final state

**Controlled public-beta release decision: GO — RECORDED 2026-08-28.**

All non-deferred hard gates were satisfied or supported by still-valid decisive evidence at the decision baseline. Qualified Japanese counsel review remains the explicitly deferred exception.