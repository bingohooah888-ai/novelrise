# NOVELIGHT Preview / Staging automation

This document records the stable operating model for Vercel Preview deployments after PR #149.

## Goal

All Vercel Preview deployments must use the isolated Supabase Staging target automatically, without per-branch environment-variable setup or repeated manual redeploys.

## Canonical Vercel variables

Use these NOVELIGHT-owned variable names only:

- `NOVELIGHT_STAGING_SUPABASE_URL`
- `NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY`

They must contain the Supabase **staging / PREVIEW** Project URL and browser-safe publishable key.

Do not use generic `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY` for Preview isolation. External integrations may manage those generic names and can overwrite them.

## Vercel scope

The two `NOVELIGHT_STAGING_*` variables should be configured once for the **Preview environment as a whole**.

They are intentionally not branch-specific. Because the names are dedicated to Staging and the application rejects the known Production Supabase host, making them available to all Preview deployments removes repeated setup while preserving fail-closed behavior.

Production must not receive these variables.

After the Preview-wide values are confirmed, old branch-specific duplicates may be removed to keep a single source of truth.

## Automatic deployment proof

`.github/workflows/staging-live-proof.yml` runs on pull requests to `main`.

The workflow:

1. derives the Vercel branch Preview URL automatically;
2. waits and retries for up to five minutes while Vercel is still deploying;
3. reads only `/api/staging-browser-config`;
4. fails if the returned host is the known Production Supabase host;
5. fails if the host is not a Supabase host;
6. fails if the key is not browser-safe;
7. never prints the publishable key.

A manual `workflow_dispatch` may provide an explicit `preview_url` only when Vercel's generated branch alias cannot be derived predictably.

## Agent / implementation preflight

Before an implementation agent commits JavaScript, tests, JSON, or GitHub Actions YAML, run:

```text
npm run preflight:agent
```

`preflight:agent` runs the formatting fixer before lint, tests, syntax checks, merge-readiness checks, and whitespace checks. This exists to prevent avoidable CI round-trips caused only by Prettier formatting.

CI remains authoritative and check-only; CI does not auto-commit formatting changes.

## Manual-operation policy

Per-branch Vercel environment-variable entry and manual Redeploy are no longer the default path.

Manual UI work is reserved for:

- the one-time Preview-wide `NOVELIGHT_STAGING_*` setup;
- secret rotation;
- account/OAuth/2FA steps that cannot be automated safely;
- exceptional recovery when automated deployment proof cannot resolve a Preview alias.
