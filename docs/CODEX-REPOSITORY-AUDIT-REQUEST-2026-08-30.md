# Codex repository-wide audit request

This branch exists only to request an independent Codex audit. Do not merge this audit-request file into `main`.

## Audit baseline

Audit the repository as it exists at base `main` commit:

`e43e8b9003b7bad5ab0b2b84b8b20b00b31e8501`

Before forming findings, read the current repository authority in this order:

1. `docs/NOVELIGHT-MASTER.md` in full
2. `docs/WORK-EXECUTION-PREFLIGHT.md`
3. `docs/EXECUTION-TURN-CARD-GATE.md`
4. `docs/EVIDENCE-FRESHNESS-GATE.md`
5. `docs/IMAGE-EXECUTION-GATE.md`
6. `AGENTS.md`
7. `docs/development-workflow.md`
8. any other guide needed for a finding

## Task

Perform an independent repository-wide beta-readiness audit. This is deliberately broader than reviewing the one documentation file changed by this PR. Use the PR only as a safe trigger and reporting surface. Inspect the relevant codebase, tests, migrations, workflows, and contracts across the repository.

Do not make code changes. Do not mutate Production, Supabase Production, Stripe, Vercel Production, secrets, or external state. Read-only commands/tests are allowed when safe and useful.

Do not assume existing green CI or historical release evidence means the implementation is correct. Look for defects and missing coverage outside existing tests.

## Required audit lanes

Audit at least these areas:

- authentication/session flows and safe post-login redirects
- authorization/ownership enforcement in browser code, APIs, Supabase RLS, RPCs, and destructive flows
- novel/episode create, publish, edit, delete, and failure/partial-failure behavior
- atomicity and concurrency, especially novel/episode publication and numbering
- favorites, LIGHT SEED, SCOUT RECORD, exposure/impression/conversion analytics, PV and anti-abuse boundaries
- billing/Stripe API authorization, entitlement transitions, webhook safety/idempotency, cancellation and failure behavior
- user-controlled content rendering, DOM injection/XSS, URL handling/open redirects, unsafe error leakage
- async UI loading/failure states, double-submit/race conditions, stale session handling, mobile-critical flows
- API method/auth/input validation and trust-boundary mistakes
- Supabase migrations, prechecks/postchecks/rollback, RLS policy drift, SECURITY DEFINER/RPC privilege boundaries
- GitHub Actions trigger/concurrency/permissions/supply-chain risks, selective-gate blind spots, skip semantics, Production approval controls
- backup/recovery and destructive-data safety contracts
- critical navigation/link completeness and auth-gated author journeys
- mismatch between current implementation and current beta-release evidence after later material changes
- stale/dead code, duplicated security logic, inconsistent allowlists/constants, and cross-file contract drift
- missing regression tests for any defect found

## Finding standard

Only report actionable findings supported by repository evidence. For every finding provide:

- severity: `P0`, `P1`, `P2`, or `P3`
- concise title
- affected file(s) and exact line/range when possible
- user/security/operational impact
- concrete reproduction or failure path
- why existing tests/gates do not catch it
- smallest safe remediation direction
- regression test that should be added
- confidence: high / medium / low

Severity guide:

- `P0`: beta-blocking security/data-loss/auth/billing/major core-flow failure or unsafe Production control
- `P1`: serious user-facing correctness/reliability/security weakness that should be fixed before or immediately at beta
- `P2`: meaningful but non-blocking correctness, maintainability, observability, or UX defect
- `P3`: minor quality issue

Prioritize correctness over finding count. Explicitly say when an investigated lane produced no actionable finding.

## Independence requirement

Do not anchor on findings from another AI or prior discussion. Derive findings independently from the repository. Do not treat this request file itself as a product defect.

At the end provide:

1. P0/P1/P2/P3 counts
2. the single highest-priority next fix
3. any beta-release evidence that should be classified `refresh-required`
4. a list of audit lanes examined with no actionable finding
