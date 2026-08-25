# NOVELIGHT β Release Evidence — 2026-08-26

This record supplements `docs/BETA-RELEASE-EVIDENCE-2026-08-23.md` with the current state after the authenticated funnel, isolated Stripe billing, and Staging-readiness work completed on 2026-08-25/26.

It is a release-evidence record, not legal advice and not a declaration that public beta is ready.

## Current decision

**Public beta GO: NOT YET RECORDED.**

The controlled technical Staging gates listed below have evidence. The remaining external/legal and Production-webhook gates remain open.

## Controlled technical evidence completed

### 1. Full authenticated Staging product smoke — PASS

Evidence:

- Workflow: `NOVELIGHT Staging Authenticated Smoke`
- Run: `32864161552`
- Revision: `e093df6402a4372d2c9d8bf3d21bae9031ef09bf`
- Conclusion: success

The authenticated Staging smoke covers the controlled beta product path including author/reader authentication, published content flows, favorite/LIGHT SEED/SCOUT RECORD behavior, and author analytics.

The LIGHT ANALYTICS funnel evidence includes the basic chain:

1. impression
2. novel-detail open
3. first-episode 10-second read proxy
4. second-episode continuation
5. favorite

This evidence is isolated from Production Supabase.

### 2. Complete isolated Stripe test billing smoke — PASS

Evidence:

- Workflow: `NOVELIGHT Staging Billing Smoke`
- Run: `32866023997`
- Revision: `1b0b16ea0b99d0c76fd7bf000c7913be630e2ed8`
- Conclusion: success

The controlled Stripe test-mode browser flow verifies:

1. Stripe test Checkout
2. Standard entitlement reconciliation into isolated Staging
3. Stripe Billing Portal access
4. subscription cancellation through the hosted portal
5. resulting subscription-state reconciliation back into isolated Staging
6. cleanup of ephemeral Staging billing data

Production card data and live charges are not used by this smoke.

### 3. Hardened Staging readiness smoke — PASS

Evidence:

- Workflow: `NOVELIGHT Staging Readiness Smoke`
- Run: `32867148248`
- Revision: `e228c9df77a573e06a8408b6fe1f9de153357cee`
- Conclusion: success

The run verifies a non-production Vercel Staging target, exact deployed revision, and the read-only browser Staging surface.

The workflow now rejects non-Vercel `deployment_status` URLs and falls back to the dedicated isolated Staging alias rather than treating arbitrary HTTPS URLs as Staging.

## Safety evidence retained

- Production and Staging Supabase targets are separated by automated guards.
- Billing Staging reconciliation fails closed outside Preview/test-Stripe/non-production-Supabase conditions.
- Staging authenticated/billing fixtures are ephemeral and cleanup is part of the workflows.
- Vercel automation bypass credentials are not intentionally sent to Stripe hosted pages.
- The protected Staging Preview was not weakened solely to make the Stripe test pass.

## Remaining hard gates

### A. Qualified Japanese legal review or explicit residual-risk decision — OPEN

Current state:

- Qualified Japanese counsel review: pending.
- Explicit owner decision to launch without qualified review and accept residual legal risk: not recorded.
- Legal public-beta GO: not recorded.

Preparation materials:

- `docs/legal-beta-review.md`
- `docs/LEGAL-REVIEW-PACKET-2026-08-26.md`
- `terms.html`
- `privacy.html`
- `content-guidelines.html`
- `billing-policy.html`
- `commerce-disclosure.html`
- `contact.html`
- `signup.html`
- `pricing.html`
- `docs/BETA-OPERATIONS-RUNBOOK.md`

This gate must not be marked complete solely from an AI/engineering review.

### B. External Stripe → Production webhook delivery — OPEN

The successful protected-Staging billing smoke uses a Staging-only reconciliation path because external Stripe webhooks cannot be treated as proven through that protected Preview path.

Before Production paid entitlements are relied upon, separately prove the real path:

`Stripe live/test event appropriate to the Production release rehearsal`

→ `Production /api/stripe-webhook`

→ signature verification

→ intended Production subscription-state update

The test must use a controlled method that does not create unintended live charges or corrupt real customer data.

Do not treat the Staging reconciliation PASS as evidence for this external Production delivery gate.

### C. Final release observations after material legal/billing changes — OPEN UNTIL FINAL CANDIDATE

After qualified legal review and any resulting changes, re-run/re-observe the applicable release checklist before public beta, including:

- legal/contact links reachable from intended major public surfaces;
- signup consent links and wording;
- pricing, recurring billing, cancellation/refund, and commerce-disclosure links;
- relevant CI/CodeQL and Staging readiness checks;
- controlled authenticated/billing checks when affected by the final changes.

## Release interpretation

The technical Staging evidence is now substantially stronger than the 2026-08-23 record: authenticated product behavior, LIGHT ANALYTICS funnel behavior, and the isolated Stripe test billing lifecycle have controlled browser evidence.

However, NOVELIGHT is **not** recorded as public-beta GO until the remaining hard gates above are resolved and the final candidate is rechecked.
