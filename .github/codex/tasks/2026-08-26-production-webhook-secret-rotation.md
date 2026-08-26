# Codex task: safe Production webhook secret rotation repair

## Context

A controlled Production webhook proof is still failing after a successful Stripe Production Bootstrap. The latest evidence is:

- `NOVELIGHT Stripe Production Bootstrap #3` succeeded, including live Stripe object validation, Vercel Production env sync, Production redeploy, and API route reachability.
- `NOVELIGHT Production Webhook Control #6 / Attempt 5` still failed after about 3 minutes because the Production profile remained `plan: free` with null Stripe customer/subscription IDs.
- Current bootstrap behavior treats an existing live webhook endpoint plus an existing Vercel `STRIPE_WEBHOOK_SECRET` as acceptable, updates the endpoint events, and returns `secret: null`, so Vercel keeps whatever signing secret it already had.
- This can leave Stripe's live endpoint signing secret and Vercel's `STRIPE_WEBHOOK_SECRET` out of sync indefinitely.

This branch was created from certified latest `main` commit:

`d929a5597f29bbfb8096f2553609a780517c39ff`

Certified blobs on that commit:

- `docs/NOVELIGHT-MASTER.md`: `262530bc88d5bb0e63fcc62f929da78120b86073`
- `docs/WORK-EXECUTION-PREFLIGHT.md`: `8c556ee11106c2a2da81000d66d0a72bdd2d4572`
- `AGENTS.md`: `7b41960b9e644080b502d0996f4083b6596ae7ff`

## Goal

Add an explicit, approval-gated webhook signing-secret rotation/repair mode to the existing Stripe Production Bootstrap so an operator can safely replace the live NOVELIGHT webhook endpoint, obtain a fresh signing secret, sync that secret to Vercel Production, and redeploy.

Do not run any Production operation while implementing this task.

## Required behavior

1. Add a boolean `workflow_dispatch` input to `.github/workflows/stripe-production-bootstrap.yml`, e.g. `rotate_webhook_secret`, default `false`.
2. Pass that input to `scripts/stripe-production-bootstrap.mjs` as an explicit environment value.
3. Preserve the current default behavior when rotation is `false`.
4. When rotation is `true`:
   - operate only inside the existing `production-approval` environment and existing live-key guards;
   - if exactly one matching live NOVELIGHT webhook endpoint exists, create a replacement live endpoint first with the same canonical URL and required event set;
   - validate that the replacement is live and returns a signing secret;
   - delete the old endpoint only after the replacement exists;
   - if deleting the old endpoint fails, best-effort delete the replacement and fail closed so the previous endpoint remains the intended survivor;
   - return the replacement signing secret so the existing Vercel sync step overwrites `STRIPE_WEBHOOK_SECRET`;
   - if no matching endpoint exists, create one normally and return its secret;
   - still fail closed if multiple matching endpoints exist.
5. In rotation mode, an existing Stripe endpoint must be repairable even if Vercel currently lacks `STRIPE_WEBHOOK_SECRET`; the missing/stale secret is exactly what this mode repairs.
6. Do not expose or log the signing secret.
7. Add targeted automated coverage for the rotation behavior. Prefer testable extracted logic/dependency injection over brittle string-only assertions if practical. Cover at least:
   - default existing-endpoint path does not rotate;
   - rotation success returns the new secret and removes the old endpoint;
   - old-endpoint deletion failure cleans up the replacement and fails closed;
   - multiple matching endpoints still fail closed.
8. Update `docs/STRIPE-PRODUCTION-BOOTSTRAP.md` with the repair-mode purpose, safety model, and operator flow.
9. Keep scope focused. No unrelated product changes, no Supabase schema changes, no secret changes, no Production workflow execution, no merge.
10. Run the smallest relevant verification, including targeted tests and `npm run preflight:fast` (or explain any environment limitation). Also run formatting/diff checks as appropriate.

## Recovery/safety intent

The safe order for rotation is replacement-create -> validate -> old-delete -> Vercel secret sync -> Production redeploy. This minimizes outage risk. A brief duplicate-delivery window is preferable to deleting the only known endpoint before a replacement exists; webhook processing is expected to be state-sync/idempotent enough for that short overlap, and audit writes are keyed by Stripe event ID.

## Handoff requirement

If this cloud checkout cannot push to the PR branch, do not stop at a prose summary. Return all of the following so the ChatGPT GitHub connector can apply the verified change without reconstructing it:

- exact unified diff for every changed repository file;
- complete final content of each changed file when reasonably sized;
- exact tests/commands run and their results;
- any remaining caveats.

Do not perform or approve any Production action.