# NOVELIGHT AI 02-07-05 | Trusted read-only evidence contracts and recovery plan

Base main: `131bd7b84543ee80d9915dfcc1709030d9bdda3b`. 2026-11-01 JST.

## In this PR: dormant / no live execution
- Introduces `stage-readonly-proofs.mjs`, a pure validator for six distinct **read-only observations**: exact GitHub main SHA, independently protected OWNER Staging runner, correct READY/SSO-protected Vercel Preview, applied one-shot Staging migration, verified synthetic per-episode consent, and current provider price/exchange-rate plus external enforced ceiling.
- All six are default-deny on missing, stale, mismatched or failed observations. The injected observers are **not** trustworthy by construction: a subsequent protected-runner change must separately review the authentication, source and response parsing for each adapter. This PR does not connect these functions to the previously merged protected executor.
- Introduces `independent-recovery-plan.mjs`, a pure **decision-only** contract for a cancellation/orphaned CLAIM: it proposes independent AI OFF/zero budget, Preview shutdown, synthetic session revocation/fixture cleanup, zero census, and non-secret consumed tombstone, with **no retry of paid API**. It does not execute any cleanup.
- Adds focused synthetic tests for incorrect scopes, Production Preview, unprotected runner, missing migration, missing consent, soft-only billing cap, exceptions, expired approvals, orphan CLAIM, consumed-but-residual data, stale evidence, and no-op terminal state.

## Explicit NO-GO / blockers
- These are offline pure functions, not a live external watchdog, runner, secret reader, migration or provider client. No workflow is changed or dispatched. Existing OWNER read-only Staging workflow remains untouched.
- A truly out-of-process cancellation recovery job, authenticated adapters, real Preview environment stop, independent migration and consent proof, verified provider-billing hard ceiling, independent zero-residue census, and scoped OWNER Stage/paid approvals remain mandatory before any paid live test.
- `PR 本番承認` covers only a separately approved main merge plus the platform's ordinary auto deploy. It does not approve Preview, Staging DB, real JWT, paid API, AI ON, runtime secrets, manual deployment or general release.
