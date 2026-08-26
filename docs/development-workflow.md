# NOVELIGHT development workflow

This document defines the normal development path after the initial environment setup.

## Standard flow

1. Read `docs/NOVELIGHT-MASTER.md`, `docs/WORK-EXECUTION-PREFLIGHT.md`, and `AGENTS.md` before changing code or operating external services. The MASTER remains the higher-level authority; the execution preflight is the mandatory runtime checklist that prevents timing, automation, manual-operation, and completion gates from being skipped.
2. Work on a dedicated branch. Do not make feature changes directly on `main`.
3. Keep each change focused. Authentication, Supabase RLS, Stripe/billing, permissions, personal data, destructive migrations, and production deployment are high-risk changes and require extra review plus a rollback or recovery plan.
4. Run the smallest relevant local gate. `npm run preflight` is the normal read-only fast gate. Add `preflight:db` for core DB/RLS changes, `preflight:e2e` for browser-facing changes, and `preflight:full` only for high-risk or broad changes. Use `preflight:fix` only when intentional formatting changes are wanted.
5. Open a pull request to `main` and record purpose, impact, verification, security/data-safety checks, Vercel Preview status when relevant, and rollback notes.
6. Merge only after the required `check` status succeeds. The CI classifier runs only relevant preflight, DB/RLS, browser, and dependency gates, while preserving the final aggregate `check`. CodeQL must also be clean when it applies.
7. Classify the PR before merge. Eligible low-risk PRs may be squash-merged automatically after all required evidence is green; high-risk or ambiguous PRs remain explicit user approval points. Use squash merge for the normal solo-development flow so `main` stays easy to audit and revert.
8. Production Supabase migrations use the dedicated auto-deploy workflow with explicit production approval. The manual Supabase workflow is fallback/recovery only.

## Execution preflight

`docs/WORK-EXECUTION-PREFLIGHT.md` is mandatory for tool-backed NOVELIGHT work. In particular, estimate total and phase time before execution, estimate how many user-only manual operations are expected, and re-check automation whenever the same phase would require more than three user operations. Repeated UI failure must trigger a route reassessment instead of repeating the same instruction indefinitely. Secret entry, 2FA, OAuth approval, destructive actions, and production approvals remain deliberate user-controlled boundaries.

## Conditional auto-merge

The user has pre-authorized automatic squash merge for ordinary low-risk PRs once the task itself has been authorized and all required evidence is green. Do not ask for a separate `merge` confirmation for every eligible PR.

A PR is eligible only when all of the following are true:

- the PR is not draft and the diff matches the intended focused scope
- the branch is current with `main`, mergeable, and has no conflict
- the aggregate required `check` is successful
- CodeQL is successful whenever CodeQL applies
- every diff-relevant DB/RLS, browser, dependency, security, or other required gate is successful
- deploy-relevant work has the required Vercel Preview evidence
- there are no secrets or credentials in the diff, logs, or PR text
- there are no unresolved REQUEST_CHANGES or material review findings
- the change is clearly outside the manual-approval categories below

Typical eligible work includes small UI/copy changes, non-sensitive scoped bug fixes, test improvements, non-governance documentation, and behavior-preserving limited refactors. A normal Vercel Production deployment caused by merging an eligible low-risk PR is covered by this standing auto-merge authorization. This does not authorize additional writes to external Production data, billing, secrets, or infrastructure outside the ordinary deploy resulting from the merge.

Require explicit user approval before merging any PR that touches or materially changes:

- authentication, Supabase RLS, Stripe/billing, pricing or entitlements, permissions, personal data, or security boundaries
- secrets, API keys, sensitive environment variables, or Production credentials
- Supabase migrations, Production DB schema/data, deletion/migration of stored data, or other destructive changes
- Production workflows, deployment infrastructure, approval gates, rollback/recovery paths, or other operational safety controls
- `docs/NOVELIGHT-MASTER.md`
- `AGENTS.md`, `docs/WORK-EXECUTION-PREFLIGHT.md`, or `docs/development-workflow.md` when changing approval boundaries, safety gates, or auto-merge rules
- CI, CodeQL, or test changes that weaken a required gate or attempt to bypass a failing gate
- any change whose risk classification, impact radius, or rollback path is unclear

When uncertain, fail closed and request approval. A high-risk PR does not become auto-mergeable merely because CI and CodeQL are green.

## Automation efficiency

Automation is not considered efficient merely because it is automatic. Every workflow should minimize total elapsed time, compute, repeated setup, failure-recovery time, and maintenance burden without weakening safety.

Prefer:

- change-based execution instead of unconditional full-suite execution
- independent jobs in parallel
- one shared implementation for repeated DB/production checks
- existing runner/platform capabilities instead of repeated downloads/setup
- isolated failed-job reruns instead of restarting unrelated successful work
- narrow path filters for dedicated workflows

Do not remove meaningful safety redundancy. Production DB checks before approval and after the approval wait, dry-runs, permission-boundary tests, rollback verification, and fail-closed production guards remain deliberate.

## CI architecture

`NOVELIGHT CI` first classifies changed files and then runs only relevant jobs:

- **Preflight**: formatting check, ESLint, Node tests, automatic JavaScript syntax discovery, `git diff --check`, and shell syntax validation.
- **RLS integration and rollback**: PostgreSQL-backed core RLS/migration verification through `scripts/run-rls-integration.sh`.
- **Browser E2E**: public smoke and async UI behavior. CI uses the Chrome already present on the GitHub runner rather than downloading another Chromium copy.
- **Dependency audit**: application and isolated Playwright lockfiles, only when dependency manifests change.

The final `check` job accepts a skipped job only when the classifier determined that gate was irrelevant. A failed classifier or relevant gate fails `check`.

Dedicated database workflows such as Beta P0 and contact inquiry security own their specific migration/test sets. Their path filters must not wake unrelated core DB suites unnecessarily.

## Browser automation

Browser tests live under `tests/e2e/` with pinned dependencies. The normal suite uses a single Chromium/Chrome project because request-based and async UI tests are device-independent. Mobile layout coverage is explicit inside the tests using a 390×844 viewport, so the entire suite is not duplicated under a second mobile project.

Run locally with:

```bash
cd tests/e2e
npm ci
npx playwright install chromium
npm test
```

On CI failures, Playwright keeps trace, screenshot, video, HTML report, browser console/page errors, request diagnostics, and failure snapshots as Actions artifacts. Inspect those artifacts before simply rerunning a failed test.

## Staging

`docs/STAGING-RUNBOOK.md` is the single Staging runbook.

The current automatic Preview/Staging gate is read-only because production Supabase connection details are still embedded in the static application. It verifies non-production deployment targets without allowing production write testing by accident.

Authenticated/write Staging E2E is gated by `STAGING_E2E_READY`. Enable it only after a dedicated Staging Supabase project and Stripe test-mode configuration exist. Once enabled, write-heavy authenticated E2E should run in Staging; production keeps a deliberate approval-gated fallback rather than being the routine test environment.

## Production readiness

Production readiness should verify the deployed result without redoing unrelated work:

- push-triggered static verification checks only changed deploy-relevant static files
- scheduled/manual readiness performs a full static sweep
- safe GET/API contract checks remain read-only
- production reader smoke suppresses measurement writes and uses a read-only lookup to choose a valid published episode instead of serially opening many works
- old read-only readiness runs may be cancelled in favor of the latest revision

Production authenticated/write smoke remains approval-gated while independent Staging is not ready.

## Supabase production deployment

Normal migration pushes use `.github/workflows/supabase-production-auto-deploy.yml` only. The workflow verifies expected pending migrations, runs a dry-run, waits for `production-approval`, then re-verifies pending state and dry-run before deployment. This second verification is intentional safety redundancy.

`.github/workflows/supabase-production.yml` is manual fallback for `status`, `dry-run`, `repair-history`, and deliberate `deploy`; it does not auto-run on normal migration pushes. Repeated observability and pending-migration logic lives in shared scripts rather than being copied between workflows.

## Vercel deployment policy

`main` remains the production branch. Deploy-relevant feature, fix, and security branches keep normal Vercel Preview behavior.

To avoid wasting deployment quota on repository-only work, `vercel.json` disables automatic Vercel deployments for:

- `chore/**`
- `test/**`
- `docs/**`
- `dependabot/**`

If one of these branches unexpectedly contains a deploy-relevant application change, move the work to a deploy-enabled branch or deliberately create a manual preview.

## Security gates

GitHub Actions uses least-privilege permissions and pinned action SHAs. Dependency auditing blocks high/critical known vulnerabilities when dependency files change. CodeQL remains a separate security scan for code-relevant PR/main changes plus scheduled full scanning; docs-only changes do not need a redundant CodeQL run.

Dependabot continues to propose dependency updates. The narrowly approved safe auto-merge flow wakes once after CodeQL and verifies the required CI state, rather than doing duplicate no-op checks after both CI and CodeQL events.

Never bypass a failed gate simply to merge. Fix the defect, dependency issue, flaky test, or infrastructure problem, or deliberately change the gate with documented reasoning.

## AI development roles

The default NOVELIGHT AI development flow is:

1. ChatGPT acts as strategy and architecture partner: scope, tradeoffs, risk, MASTER alignment.
2. Codex is the primary implementation agent for repository changes.
3. Automated gates provide objective evidence.
4. Authentication, RLS, Stripe/billing, permissions, personal data, destructive migrations, and other high-risk changes receive an independent second-model review such as Claude Code when practical.
5. AI approval never overrides a failing automated gate.
6. Eligible low-risk `main` merges may proceed automatically after the required gates pass; high-risk merges, production database changes, external Production state changes, and other explicit categories above remain deliberate user approval points.

Use the smallest set of agents/tools that materially improves speed, quality, or safety.

## Ready-to-merge definition

A change is ready to merge when its scope is understood, the relevant selective gates have passed, secrets are absent, high-risk boundaries have been reviewed, dependency changes are safe, deploy-relevant UI has been previewed when appropriate, rollback/recovery is known where needed, and the branch is current with `main`. Being ready to merge does not remove an explicit approval requirement for a high-risk PR.

## Environment work stopping rule

Do not keep adding tooling because more automation is possible. Add or refactor tooling when it removes repeated work, materially reduces elapsed time, closes a concrete reliability/security gap, lowers operational risk, or is required by a platform change. Otherwise prioritize NOVELIGHT product development.
