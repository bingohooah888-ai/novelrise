# NOVELIGHT β Release Evidence — Latest Reconciled State

**Reconciled: 2026-08-28 JST**

This file is a rolling current-state index. Dated `BETA-RELEASE-EVIDENCE-*.md` files remain historical snapshots and must not be treated as newer than later workflow/live evidence.

This index is not a substitute for `docs/EVIDENCE-FRESHNESS-GATE.md`. If a newer decisive workflow, approval ledger entry, commit, deployment, or read-only live observation exists, the newer same-scope evidence wins after invalidation analysis.

## Current main

- `48639b9e56b25070794b622739c8f9d3698fc99e`
- Commit: `Add beta legal checkout disclosures`

## Current release decision

**Public beta GO: NOT YET RECORDED.**

Do not infer GO from one completed gate. The full `docs/BETA-RELEASE-CHECKLIST.md` and remaining legal/operational evidence still govern release readiness.

## Reconciled technical evidence

### Authenticated Staging product smoke — PASS

Historical controlled evidence remains recorded in `docs/BETA-RELEASE-EVIDENCE-2026-08-26.md` for the authenticated Staging product path and LIGHT ANALYTICS funnel.

### Isolated Stripe test billing smoke — PASS

Historical controlled evidence remains recorded in `docs/BETA-RELEASE-EVIDENCE-2026-08-26.md` for Stripe test Checkout, entitlement reconciliation, Billing Portal, cancellation, and cleanup in isolated Staging.

### Production external Stripe webhook delivery — PASS

The 2026-08-26 evidence file still says this gate was open, but that statement is historical and was superseded by a later Production proof.

Decisive later evidence:

- Workflow: `NOVELIGHT Chat-Mediated Production Approval`
- Run: `33065836764`
- Proof SHA: `944c2232a577ebeae32798c29a508b8540a26807`
- Workflow conclusion: `success`
- Decisive completion log: `PASS: exact chat-approved Production remediation, no-charge external webhook proof, and final billing audit completed.`
- Approval ledger: issue `#165` records the request as `NOVELIGHT_PRODUCTION_CONSUMED ... result:"success"`.
- Completion contract required `noChargeWebhookProof == true` and `finalIssueCount == 0`.

This proves the scoped technical gate:

`Stripe Live event creation without a paid charge -> Production webhook -> Production Supabase entitlement/cancellation reflection -> final billing audit`.

No artificial live payment was required.

### Production webhook proof freshness versus current main

`944c2232...` was compared with current main `48639b9e...`.

Current main is five commits ahead. Later changes include Production billing guard/chat-approval control-plane changes, Staging workflow consolidation, execution-governance changes, and final Checkout/legal disclosure copy.

The comparison does **not** include changes to the decisive webhook handler `api/stripe-webhook.js` or the Production remediation proof implementation `api/production-billing-remediate.js`.

Therefore the existing Production external-webhook proof remains **current for that specific delivery gate**. Advancing `main` alone is not a reason to repeat the Production mutation. A later material change to the webhook handler, Stripe endpoint/signing-secret state, Production Supabase target, proof implementation, or equivalent proven boundary would require a new freshness decision.

## Legal P0 implementation state

The beta legal checkout-disclosure implementation is merged on current main.

Implemented code/public-copy changes include the final Checkout recurring-contract notice, annual payment estimates, aligned billing/commerce/privacy language, and regression coverage.

This engineering/legal-copy implementation does **not** replace a qualified Japanese legal review.

## Remaining release gates

At minimum, the following remain unresolved or require final-candidate observation before Public beta GO can be recorded:

1. **Qualified Japanese legal review or explicit owner residual-risk decision** — not recorded as complete.
2. **Final release observations after material legal/billing changes** — the applicable release checklist must be re-observed against the final candidate.
3. **Any unchecked hard item in `docs/BETA-RELEASE-CHECKLIST.md` that lacks newer decisive evidence** — an unchecked historical box is not automatically open or closed; resolve it through the Evidence Freshness Gate before acting.

Do not repeat the already-proven Production webhook mutation merely because the 2026-08-26 snapshot still says `OPEN`.

## Required interpretation rule

Before naming the "next open gate":

1. read this rolling index;
2. inspect newer relevant workflow/ledger evidence;
3. compare proof SHA to current main for material invalidation;
4. inspect current read-only external state if needed;
5. only then classify the gate as `current`, `refresh-required`, or `unknown`.

If existing evidence is `current`, move to the next genuinely open item instead of re-running the completed operation.
