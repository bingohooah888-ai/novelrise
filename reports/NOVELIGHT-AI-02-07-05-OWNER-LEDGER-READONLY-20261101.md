# NOVELIGHT AI 02-07-05 — Read-only GitHub OWNER ledger verifier

Base main SHA: `e124b148acebb9b8884e4c0eeee3dd90b2ac73c9`

## Added, entirely offline
- `.github/staging-ai-02-07-05/owner-ledger-readonly-verifier.mjs` checks a **complete** read-only GitHub REST snapshot from protected control Issue #294, binding exact OWNER-approved SHA, Staging Preview, synthetic actor/novel/episode, model, cap and consent revision.
- Restricts original approval to the known repo OWNER login + account ID, and CLAIMED/CONSUMED markers to GitHub Actions bot login + account ID. Validates immutable IDs/timestamps, monotonic ordering, exact JSON keys, the one CLAIM then at most one CONSUMED, matching run ID, and no stale/missing pagination. A corrupted or replayed record fails closed.
- Returns `UNCLAIMED`, `CLAIMED`, or `CONSUMED` with `noPaidRetry: true` and `authorizesPaidCall: false`, **never** a paid-execution token.
- Synthetic tests cover valid, missing, duplicate, forged, malformed, edited, expired, wrong-SHA/actor, count changes and multi-page snapshots.

## Still not trusted live evidence
- This module accepts **data** from a future separately reviewed GitHub REST reader. It cannot authenticate network origin, assert a complete race-free snapshot or establish environment protection on its own. `snapshot.repository` and `commentsCountAfterFetch` are only contracts to be fulfilled by a trusted adapter, not proof of GitHub origin.
- Existing `owner-paid-trial-ledger.mjs`, paid provider, independent recovery planner and read-only workflow remain unmodified; no workflow is dispatched or enabled.
- Before any live paid trial: independently approved Staging Preview and migration, real synthetic consent/JWT and privacy, current provider charges and hard cap, separate authenticated REST adapter, protected runner, mandatory external stop/watchdog and exact-scope OWNER approvals are still required.

This PR is code/offline-test only and needs a separate exact-HEAD `本番承認` to merge; a merge can trigger ordinary automatic Production deployment. No new Preview, Staging mutation, JWT, paid model call, AI activation, Stripe or manual Production mutation is authorized.
