# Task: collapse Production billing repair + webhook proof into one approval

Certified base: `main` at `6378289d13f6d657c8a6a9f3b9cacb15e3eb03a2`.

## Goal

Make the normal NOVELIGHT Production Stripe bootstrap finish the whole approved repair/proof sequence inside one `production-approval` job:

1. synchronize the authoritative Production Supabase credentials into Vercel Production,
2. synchronize Stripe Production variables as today,
3. redeploy Vercel Production,
4. verify the Production Stripe routes are reachable,
5. finalize any webhook-secret rotation,
6. run the existing no-live-charge `scripts/production-webhook-control.mjs` proof against the final deployed state,
7. retry only that control proof automatically once if it fails, without requiring another GitHub Environment approval.

The user wants to keep one deliberate Production approval boundary, not remove Production approval entirely.

## Context / observed failure

After PR #143, `NOVELIGHT Stripe Production Bootstrap #4` succeeded with `rotate_webhook_secret=true`: a replacement live webhook endpoint was created, the new signing secret was synchronized to Vercel Production, Production was redeployed, public Stripe routes became reachable, and the old endpoint was deleted.

`NOVELIGHT Production Webhook Control #6` was then rerun and still failed after ~3 minutes because the ephemeral Production profile remained:

`{"plan":"free","payment_status":"active","stripe_customer_id":null,"stripe_subscription_id":null,"subscription_status":null}`

The GitHub approval-scoped `SUPABASE_SECRET_KEY` had already been corrected earlier, but the Stripe Production Bootstrap currently synchronizes only Stripe-related variables into Vercel. The deployed `api/stripe-webhook.js` uses Vercel's `SUPABASE_SECRET_KEY`, so stale Vercel Supabase credentials are the leading configuration gap.

## Required implementation

Keep the change focused and fail closed.

### `.github/workflows/stripe-production-bootstrap.yml`

- Keep `environment: production-approval` as the single deliberate approval boundary.
- Add `SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}` to the job environment.
- Add canonical `SUPABASE_URL: https://fiepaguycecrredwrcwx.supabase.co` to the job environment.
- Validate that the Supabase secret is present and the URL is exactly the canonical Production project before any external write.
- Synchronize `SUPABASE_SECRET_KEY` to Vercel Production without logging it.
- Synchronize `SUPABASE_URL` to Vercel Production. It is not a secret, so do not unnecessarily classify it as sensitive if the existing workflow can safely support a plain Production variable.
- Preserve all existing Stripe bootstrap/rotation safety behavior.
- After Production redeploy is reachable and webhook rotation has been finalized, run `scripts/production-webhook-control.mjs` against the final state using:
  - `STRIPE_LIVE_SECRET_KEY` from the approval environment,
  - `SUPABASE_SECRET_KEY` from the approval environment,
  - canonical `SUPABASE_URL`,
  - canonical `NOVELIGHT_APP_URL`,
  - the Standard price ID from the bootstrap output file (do not require a separate manually maintained price value for this integrated proof).
- If the control proof exits non-zero, retry the control proof only once after a short bounded delay. Do not redo Stripe provisioning, Vercel env synchronization, redeploy, or Production approval for that retry.
- A second failure must fail the workflow visibly. Do not loop indefinitely.
- Ensure the bootstrap output file containing a webhook signing secret is removed even when a later verification step fails (`always()`/equivalent fail-safe cleanup).

### `.github/workflows/production-webhook-control.yml`

- Retain this as an isolated diagnostic/recovery fallback, but stop automatically creating a second Production approval session merely because the harness file changes.
- Prefer explicit `workflow_dispatch` only for the standalone fallback.
- Preserve its `production-approval` environment and fail-closed input checks.

### Documentation

Update `docs/STRIPE-PRODUCTION-BOOTSTRAP.md` to document:

- `SUPABASE_SECRET_KEY` as an approval-scoped input required by the Production bootstrap,
- synchronization of the canonical Supabase URL/secret into Vercel Production,
- the integrated no-charge webhook proof after deployment,
- the single bounded automatic retry of only the proof,
- that one GitHub Environment approval covers this one bootstrap execution while separate future Production executions still require their own explicit approval,
- the standalone Production Webhook Control as a manual recovery/diagnostic fallback rather than the normal follow-up path.

If `docs/development-workflow.md` needs a minimal update to accurately capture the one-approval-per-Production-operation rule, keep it narrow.

## Safety requirements

- Do not run, approve, rerun, or dispatch any Production workflow while implementing this PR.
- Do not change any GitHub, Vercel, Stripe, or Supabase secret value.
- Do not log secrets or write them to repository files.
- Do not remove the `production-approval` Environment gate.
- Do not merge to `main`.
- Do not weaken the canonical Production Supabase/app URL guards.
- Preserve no-live-charge behavior of `production-webhook-control.mjs`.
- Avoid unrelated product-code changes.

## Verification

Run the smallest relevant gates plus targeted tests:

- workflow syntax/semantic checks where available,
- targeted tests for any new helper logic,
- `npm run preflight:fast`,
- `git diff --check`.

Do not execute the live Production proof during implementation/CI.

If this Codex cloud checkout cannot push, return the exact unified diff and complete final contents for every changed file, plus the full verification results. Do not merely summarize changes.