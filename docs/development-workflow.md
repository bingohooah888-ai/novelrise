# NOVELIGHT development workflow

This document defines the normal development path after the initial environment setup.

## Standard flow

1. Read `docs/NOVELIGHT-MASTER.md` and `AGENTS.md` before changing code.
2. Work on a dedicated branch. Do not make feature changes directly on `main`.
3. Keep each change focused. Authentication, Supabase RLS, Stripe/billing, permissions, personal data, destructive migrations, and production deployment are high-risk changes and require extra review plus a rollback or recovery plan.
4. Run the smallest relevant preflight before commit/push. `npm run preflight` is the normal fast, read-only check. Use `npm run preflight:e2e` for browser-facing behavior, `npm run preflight:db` for the core local RLS stack, and `npm run preflight:full` only when the change genuinely crosses those boundaries. Use `npm run preflight:fix` only when automatic formatting changes are intentionally wanted.
5. Open a pull request to `main` and record purpose, impact, verification, security/data-safety checks, Vercel Preview status when relevant, and rollback notes.
6. Merge only after the required `check` status succeeds. `check` aggregates only the CI gates relevant to the changed files. CodeQL must also be clean when it runs, especially for security-sensitive changes.
7. Use squash merge for the normal solo-development flow so `main` stays easy to audit and revert.
8. Production-impacting actions remain deliberate approval points. Never bypass a failed safety gate simply to save time.

## Selective CI architecture

`NOVELIGHT CI` starts with a lightweight changed-file classifier, then runs independent jobs in parallel only when their inputs are relevant:

- **Fast quality**: Prettier check, ESLint, Node tests, JavaScript syntax checks.
- **Database/RLS safety**: PostgreSQL-backed core RLS integration and rollback tests.
- **Browser smoke**: local Playwright smoke tests.
- **Dependency audit**: application and Playwright lockfile vulnerability audits.

Skipped jobs are accepted by the aggregate `check` gate only when the classifier determined that the job was irrelevant. A failed classifier or a failed relevant job still fails `check`.

Dedicated database workflows keep narrow ownership of database surfaces that are not part of the core RLS runner. For example, the beta-P0 database gate and contact-inquiry security gate have their own path filters. Do not broaden those filters back to all of `supabase/**` or `tests/rls/**` unless the workflow actually validates all of those files.

## Preflight commands

- `npm run preflight` / `npm run preflight:fast`: read-only normal preflight. Runs formatting check, lint, Node tests, automatic JavaScript syntax discovery, and `git diff --check`.
- `npm run preflight:fix`: intentionally formats files first, then runs the fast checks.
- `npm run preflight:db`: runs `scripts/run-rls-integration.sh` against the configured local PostgreSQL test database.
- `npm run preflight:e2e`: runs the Playwright smoke suite in `tests/e2e/`.
- `npm run preflight:full`: fast + DB + E2E. Reserve this for genuinely cross-cutting or high-risk changes.

The default preflight must not modify files. Formatting changes are an explicit action, not a side effect of verification.

## Browser automation

Browser smoke tests live under `tests/e2e/` and use pinned Playwright dependencies. CI uses the Chrome already present on the GitHub-hosted runner instead of downloading a separate Chromium bundle on every run.

The generic smoke suite has a single Chromium/Chrome project. Tests that only use Playwright's HTTP request client are not repeated for desktop and mobile because the result is device-independent. Mobile layout coverage is explicit in the test itself through a 390px viewport, so it still runs without duplicating every request-level test.

Run locally with:

```bash
cd tests/e2e
npm ci
npm test
```

Local execution expects a compatible installed Google Chrome. If a development machine does not have it, install Chrome rather than adding a permanent browser download step to every CI run.

Keep the smoke suite focused on stable user-critical paths. Deeper authenticated/write tests must remain isolated from ordinary PR smoke tests.

## Vercel deployment policy

`main` remains the production branch. Deploy-relevant feature, fix, and security branches keep the normal Vercel Preview behavior.

To avoid wasting deployment quota on repository-only work, `vercel.json` disables automatic Vercel deployments for these branch families:

- `chore/**`
- `test/**`
- `docs/**`
- `dependabot/**`

If one of those branches unexpectedly contains a deploy-relevant application change, rename or recreate the work on an appropriate deploy-enabled branch, or create a deliberate manual preview. Do not use an Ignored Build Step as the primary quota-control mechanism because an ignored build can still consume deployment quota.

## Production readiness automation

The read-only production readiness workflow runs after relevant `main` changes, on schedule, or manually.

- On a normal `main` push, repository-to-production static comparison is limited to changed root HTML files and `novelight-client.js`.
- On the scheduled/manual full audit, every root HTML file plus `novelight-client.js` is compared.
- Safe API contracts, read-only production reader smoke, and production beta observability remain independent checks.
- Older read-only readiness runs may be cancelled when a newer run supersedes them.

The authenticated production smoke still writes ephemeral test data and therefore keeps its human approval gate and non-cancellable cleanup path. Until a separate Staging Supabase/Vercel/Stripe-test environment is provisioned, do not remove this approved production fallback merely for speed. Once Staging exists, move the routine write E2E there and reduce production write smoke to deliberate release/incident use.

## Supabase production migration policy

Normal production migration operation is `.github/workflows/supabase-production-auto-deploy.yml`:

1. detect migration versions introduced by the `main` push;
2. require the production pending set to exactly match those versions;
3. run a dry-run;
4. wait for the `production-approval` human gate;
5. re-check the pending set after the wait;
6. re-run the dry-run;
7. apply the approved migrations;
8. verify no pending migrations remain and run production observability.

The pre-approval and post-approval checks are intentional safety duplication and must not be removed as an efficiency optimization.

`.github/workflows/supabase-production.yml` is a **manual-only fallback** for `status`, `dry-run`, known history repair, or explicit emergency deploy. It must not also trigger automatically from the same migration push as the normal auto-deploy workflow.

Common migration-state and production-observability logic lives in reusable scripts under `scripts/` so multiple workflows can repeat a safety check without maintaining multiple independent copies of the implementation.

## Security gates

GitHub Actions uses least-privilege repository permissions and pinned action SHAs. The dependency vulnerability audit blocks high- and critical-severity known vulnerabilities when either lockfile changes or the CI workflow itself is being validated.

CodeQL remains a separate security scan for code-bearing pull requests/main changes plus the scheduled full scan. Documentation-only PR/push changes are excluded from redundant CodeQL runs; the scheduled scan remains unchanged.

Dependabot continues to propose dependency and GitHub Actions updates. GitHub Secret Scanning and Push Protection should remain enabled where available; they complement rather than replace CI.

Never bypass a failed gate simply to merge. Investigate whether the failure is a real defect, a dependency problem, a flaky test, or an infrastructure problem, then fix the cause or deliberately adjust the gate with documented reasoning.

## AI development roles

The default NOVELIGHT AI development flow is:

1. ChatGPT acts as the strategy and architecture partner: clarify scope, compare options, identify risk, and keep work aligned with the MASTER.
2. Codex is the primary implementation agent for repository changes.
3. Automated gates provide objective evidence: formatting, linting, unit/API tests, RLS tests, browser tests, dependency audits, and CodeQL as applicable.
4. Authentication, Supabase RLS, Stripe/billing, permissions, personal data, destructive migrations, and other high-risk changes receive an independent second-model review such as Claude Code before merge when practical.
5. AI approval is never a substitute for a passing relevant gate.
6. Merge to `main`, production database changes, and other production-impacting operations remain deliberate approval points.

The goal is not to maximize the number of AI agents or checks. Use the smallest combination that materially improves speed, quality, or safety.

## Ready-to-merge definition

A change is ready to merge when its scope is understood, all relevant classified gates have passed, secrets are absent, high-risk boundaries have been reviewed, dependency changes are safe, deploy-relevant UI has been previewed when appropriate, rollback/recovery is known where needed, and the branch is up to date with `main`.

## Environment work stopping rule

Automation work is justified when it measurably reduces repeated effort, waiting time, compute/deployment waste, recovery time, or a concrete reliability/security gap. Do not add another workflow simply because automation is possible. Prefer extending a clear owner, narrowing triggers, sharing stable implementation, and removing duplicate work before adding a new automation layer.
