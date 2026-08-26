# Codex task: make Production webhook control independent of Vercel pulled values

## Context

GitHub Actions run `32917226268` reached the no-charge Production webhook control script with the three `production-approval` secrets present, but failed immediately because the Vercel-pulled `STRIPE_STANDARD_PRICE_ID` was not an actual `price_...` value. Vercel Sensitive values may be returned as placeholders by `vercel env pull`.

## Goal

Make `.github/workflows/production-webhook-control.yml` fail-closed and independent of Vercel pulled values for the E2E control inputs.

## Required changes

- Read the current root `AGENTS.md`, latest `docs/NOVELIGHT-MASTER.md`, and `docs/WORK-EXECUTION-PREFLIGHT.md` first.
- Keep the job on GitHub Environment `production-approval`.
- Keep `STRIPE_LIVE_SECRET_KEY`, `SUPABASE_SECRET_KEY`, and the canonical Production Supabase URL exactly within the existing approval boundary.
- Stop using `vercel env pull` for `STRIPE_STANDARD_PRICE_ID` and `NOVELIGHT_APP_URL`.
- Remove the Vercel CLI install/link/pull path from this control workflow if it is no longer needed.
- Use canonical `NOVELIGHT_APP_URL=https://novelrise.vercel.app` directly; it is not secret.
- Source `STRIPE_STANDARD_PRICE_ID` from a GitHub `production-approval` Environment secret named `STRIPE_STANDARD_PRICE_ID` (do not invent or log a value).
- Add an explicit fail-closed `price_` format check before the control script runs.
- Remove `VERCEL_TOKEN` from this workflow if no longer required.
- Preserve the existing no-live-charge Stripe -> Production webhook -> canonical Supabase E2E proof and cleanup behavior.
- Do not add auto-repair, auto-redeploy, Vercel writes, Supabase Management API, or Production database changes.
- Keep the Production approval gate.
- Update comments/names so they describe the new source of truth accurately.

## Verification

Run the smallest appropriate checks, including ShellCheck/actionlint where available plus repository fast/static checks relevant to the workflow. Report exact results.

## Permissions / stopping rules

User has authorized implementation, commit, and push on this task branch. Do not merge to `main`. Do not run the Production webhook workflow. Do not change GitHub secrets. Do not change Vercel, Stripe, or Supabase production state. Stop after pushing the code update and reporting verification in this PR.
