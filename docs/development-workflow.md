# NOVELIGHT development workflow

This document defines the normal development path after the initial environment setup.

## Standard flow

1. Read `docs/NOVELIGHT-MASTER.md` and `AGENTS.md` before changing code.
2. Work on a dedicated branch. Do not make feature changes directly on `main`.
3. Keep each change focused. Authentication, Supabase RLS, Stripe/billing, permissions, personal data, destructive migrations, and production deployment are high-risk changes and require extra review plus a rollback or recovery plan.
4. Run `npm run preflight` before commit/push for normal JavaScript and configuration changes. When browser-facing behavior is affected, also run the Playwright smoke suite from `tests/e2e/` when practical.
5. Open a pull request to `main` and record purpose, impact, verification, security/data-safety checks, Vercel Preview status when relevant, and rollback notes.
6. Merge only after the required `check` status succeeds. `check` is the aggregate gate for formatting, ESLint, Node tests, RLS integration tests, API syntax checks, Playwright browser smoke tests, and dependency vulnerability audits. CodeQL must also be clean before merging security-sensitive changes.
7. Use squash merge for the normal solo-development flow so `main` stays easy to audit and revert.
8. Production Supabase migrations are never applied by a normal push. Use the dedicated production workflow, inspect status and dry-run first, and require the explicit deploy confirmation.

## Browser automation

Browser smoke tests live under `tests/e2e/` and use Playwright with pinned dependencies. The suite runs Chromium in desktop and mobile device profiles against a local static server, so the core browser gate does not depend on Vercel availability or deployment quota.

Run locally with:

```bash
cd tests/e2e
npm ci
npx playwright install chromium
npm test
```

Keep the smoke suite focused on stable user-critical paths. Add deeper authenticated or payment browser tests only when they can run deterministically without using production accounts, production data, or real charges.

## Vercel deployment policy

`main` remains the production branch. Deploy-relevant feature, fix, and security branches keep the normal Vercel Preview behavior.

To avoid wasting deployment quota on repository-only work, `vercel.json` disables automatic Vercel deployments for these branch families:

- `chore/**`
- `test/**`
- `docs/**`
- `dependabot/**`

If one of those branches unexpectedly contains a deploy-relevant application change, rename or recreate the work on an appropriate deploy-enabled branch, or create a deliberate manual preview. Do not use an Ignored Build Step as the primary quota-control mechanism because an ignored build can still consume deployment quota.

## Security gates

GitHub Actions uses least-privilege repository permissions and pinned action SHAs. Pull requests are blocked by the existing required `check` status unless the aggregate quality gate succeeds. The dependency vulnerability audit runs `npm audit --audit-level=high` against both the application lockfile and the isolated Playwright lockfile, blocking high- and critical-severity known vulnerabilities without depending on repository Dependency Graph settings.

CodeQL remains a separate security scan on pull requests, `main`, and the scheduled scan. Dependabot continues to propose dependency updates. GitHub Secret Scanning and Push Protection should remain enabled where available; they complement rather than replace CI.

Never bypass a failed gate simply to merge. Investigate whether the failure is a real defect, a dependency problem, a flaky test, or an infrastructure problem, then fix the cause or deliberately adjust the gate with documented reasoning.

## AI development roles

The default NOVELIGHT AI development flow is:

1. ChatGPT acts as the strategy and architecture partner: clarify scope, compare options, identify risk, and keep work aligned with the MASTER.
2. Codex is the primary implementation agent for repository changes.
3. Automated gates provide objective evidence: formatting, linting, unit/API tests, RLS tests, browser tests, dependency audits, and CodeQL as applicable.
4. Authentication, Supabase RLS, Stripe/billing, permissions, personal data, destructive migrations, and other high-risk changes receive an independent second-model review such as Claude Code before merge when practical.
5. AI approval is never a substitute for a passing gate. If an AI says a change is safe but an automated check fails, treat the failure as unresolved until investigated.
6. Commit/push follow the repository's explicit user-instruction boundary. Merge to `main`, production database changes, and other production-impacting operations remain deliberate approval points.

The goal is not to maximize the number of AI agents. Use the smallest combination that materially improves speed, quality, or safety.

## Automation boundary

GitHub Actions performs formatting checks, ESLint, automated tests, RLS integration tests, API syntax checks, Playwright browser smoke tests, dependency vulnerability audits, and CodeQL scanning. Dependabot proposes dependency and GitHub Actions updates. Only narrowly approved eslint/prettier patch updates may be auto-merged after both NOVELIGHT CI and CodeQL succeed; all other dependency updates require review.

Automation is a safety net, not permission to bypass repository rules. If CI, CodeQL, migration checks, browser tests, dependency audits, or rollback validation fails, fix the cause rather than bypassing the check.

## Ready-to-merge definition

A change is ready to merge when its scope is understood, relevant tests have passed, secrets are absent, high-risk boundaries have been reviewed, dependency changes are safe, deploy-relevant UI has been previewed when appropriate, rollback/recovery is known where needed, and the branch is up to date with `main`.

## Environment work stopping rule

With browser automation, deploy policy, aggregate security gates, and the AI role split documented, the initial NOVELIGHT development-environment setup is considered complete. Future tooling work should be added only when it clearly reduces repeated effort, fixes a concrete reliability/security gap, or is required by a platform change. Otherwise, prioritize NOVELIGHT product development.
