# NOVELIGHT Staging authenticated E2E

## Purpose

Routine authenticated write E2E should run against a non-production environment once a real Staging stack exists. Production write smoke remains an approval-gated fallback until that point.

The repository workflow is `.github/workflows/staging-authenticated-smoke.yml`. It is safe-disabled unless the Actions variable `STAGING_E2E_READY` is exactly `true`.

## Required external Staging stack

Staging must be isolated from production:

- a dedicated Supabase project/database;
- a Vercel deployment that serves the same checked-out NOVELIGHT revision and points to Staging Supabase;
- Stripe **test mode** keys/prices/webhook configuration only;
- no production users, production content, production Stripe live objects, or production service-role credentials.

The Staging deployment must expose the same beta-critical pages and APIs as production. The workflow refuses to run the write test until the critical static pages match the checked-out repository revision.

## GitHub environment configuration

Create a GitHub Environment named `staging` and configure:

Actions variables:

- `STAGING_BASE_URL`: public HTTPS URL of the Staging Vercel deployment.
- `STAGING_SUPABASE_URL`: URL of the dedicated Staging Supabase project.

Actions secret:

- `STAGING_SUPABASE_SECRET_KEY`: Staging-only Supabase secret/service-role key used to create and clean ephemeral E2E users and rows.

After the external stack is verified, set repository Actions variable:

- `STAGING_E2E_READY=true`

Do **not** set this flag before the Staging URL is deployed from the same NOVELIGHT revision, Staging Supabase has the required schema/migrations, and Stripe test mode is configured.

## Automatic transition behavior

While `STAGING_E2E_READY` is unset or not `true`:

- the Staging write workflow is skipped;
- the existing production authenticated smoke continues to run on relevant `main` changes and requires human approval.

After `STAGING_E2E_READY=true`:

- relevant `main` changes run the authenticated write smoke against Staging automatically;
- the production write smoke no longer starts automatically for those pushes;
- production write smoke remains available through `workflow_dispatch` for deliberate release/incident verification.

This transition prevents a coverage gap: production write validation is not removed until the Staging replacement has explicitly been declared ready.

## What the Staging smoke verifies

The reusable authenticated smoke covers:

- author login;
- novel creation;
- first-episode publication;
- reader login;
- favorite;
- LIGHT SEED;
- SCOUT RECORD;
- engaged reading measurement;
- LIGHT ANALYTICS;
- Standard/Premium Stripe Checkout Session creation without charging.

Staging requires Checkout Session IDs with the Stripe test prefix `cs_test_`. Production continues to require `cs_live_`.

All created users and rows are ephemeral and cleaned after the test. The workflow is deliberately non-cancellable so cleanup is not abandoned merely because a newer run begins.
