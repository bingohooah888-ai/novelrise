# NOVELIGHT development workflow

This document defines the normal development path after the initial environment setup.

## Standard flow

1. Read `docs/NOVELIGHT-MASTER.md` and `AGENTS.md` before changing code.
2. Work on a dedicated branch. Do not make feature changes directly on `main`.
3. Keep each change focused. Authentication, Supabase RLS, Stripe/billing, permissions, personal data, destructive migrations, and production deployment are high-risk changes and require extra review plus a rollback or recovery plan.
4. Run `npm run preflight` before commit/push for normal JavaScript and configuration changes.
5. Open a pull request to `main` and record purpose, impact, verification, security/data-safety checks, and rollback notes.
6. Merge only after the required `check` status succeeds. CodeQL results must also be clean before merging security-sensitive changes.
7. Use squash merge for the normal solo-development flow so `main` stays easy to audit and revert.
8. Production Supabase migrations are never applied by a normal push. Use the dedicated production workflow, inspect status and dry-run first, and require the explicit deploy confirmation.

## Automation boundary

GitHub Actions performs formatting checks, ESLint, automated tests, RLS integration tests, API syntax checks, and CodeQL scanning. Dependabot proposes dependency and GitHub Actions updates. Only narrowly approved eslint/prettier patch updates may be auto-merged after both CI and CodeQL succeed; all other dependency updates require review.

Automation is a safety net, not permission to bypass repository rules. If CI, CodeQL, migration checks, or rollback validation fails, fix the cause rather than bypassing the check.

## Ready-to-merge definition

A change is ready to merge when its scope is understood, relevant tests have passed, secrets are absent, high-risk boundaries have been reviewed, rollback/recovery is known where needed, and the branch is up to date with `main`.

## Environment work stopping rule

The initial development-environment setup is considered complete once this workflow is established. Future tooling work should be added only when it clearly reduces repeated effort, fixes a concrete reliability/security gap, or is required by a platform change. Otherwise, prioritize NOVELIGHT product development.
