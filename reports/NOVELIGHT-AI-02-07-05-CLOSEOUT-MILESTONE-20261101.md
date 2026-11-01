# NOVELIGHT AI 02-07-05 — Phase 2 concentrated closeout / Staging read-only preflight

Observation date: 2026-11-01 JST. Base main: `ab31c6fd18b3c5a730af640a98d95aeb7ef50e7e`. This is not a release, paid trial, or runtime deployment approval.

## Actual read-only evidence obtained this workstream
- Latest main before new PR: `ab31c6fd18b3c5a730af640a98d95aeb7ef50e7e`. PR #2734 has been merged, Vercel Production `dpl_84YJzAZyzZri9KWyzJrK23B2ZmAv` is READY on that SHA.
- Target Staging Supabase project: `wmlzjgvxgoyrovdhbqbg`. Actual `BEGIN READ ONLY` SQL SELECTs showed runtime singleton 1 row, `enabled=false`, all four user/global day/month AI caps **0**.
- Aggregate Staging table counts were **0**: usage requests, usage audit, bible facts, episode analysis, review candidates, external processing consents, consent action audit and the one-shot consumed claim ledger.
- Staging migration listing includes applied `20261101060000_novelight_ai_020705_one_shot_claim`. Catalog read-only SELECT: tombstone table RLS enabled, `novelight_ai_020705_claim_once` is SECURITY INVOKER, `anon` and `authenticated` lack EXECUTE, `service_role` has EXECUTE. **Actual concurrent one-call behavior remains unproven.**
- Existing Vercel READY Staging Preview `dpl_EQij5nLkYSiha2Yn4UyGYs9pszwu` was built from old main `c59b0038e06816ace42cdf2e50e24a2c02fb5927`, NOT the current SHA. No new Preview has been created.
- Supabase `get_project` metadata call returned `Project not found` from that specific endpoint even though migrations, tables and read-only SELECTs were accessible. Treat this as a scoped metadata/provider access limitation, not proof of a missing Staging database.

## Single grouped code change
- Dormant `.github/staging-ai-02-07-05/staging-readonly-baseline.mjs` exports the exact fixed SELECT query and a bound read-only result validator. It checks OFF/zero counters plus one-shot RLS/EXECUTE metadata. It performs **no I/O unless a future authorized adapter is explicitly injected** and cannot attest source/authenticity by itself.
- Focused synthetic tests cover safe OFF/zero report, nonzero caps/usage, mis-scoped Production ref, weakened RLS, stale response and sanitized errors. No SQL is run by the tests.
- Consolidated next-approval runbook: `docs/NOVELIGHT-AI-PHASE2-CLOSEOUT-GATES.md`.

## Remaining blockers — work in ONE milestone, not a stream of tiny PRs
1. **Trusted independent out-of-process watchdog**: schedule/host, independently observed heartbeat and process exit, least-privilege GitHub/Vercel/Supabase adapters, protected supervisor identity, external kill switch and deterministic cleanup even when runner is terminated. Existing offline watchdog cores cannot substitute for this.
2. **New current-main Staging Preview**: requires separately scoped staging approval before creation; verify pinned branch, env, SSO, Vercel protection. Old Preview cannot be reused for paid tests.
3. **Protected Staging runner integration and execution authority**: existing main workflow is OFFLINE PREFLIGHT ONLY, no CLAIM/CONSUMED/DB cleanup or paid call wiring. Reconcile exact GitHub Issue #294 OWNER approval, actual isolated service role, synthetic JWT/session revocation, migration schema/RLS, model/org entitlement, billing ceiling and data consent. Requires distinct approval for changes/launch.
4. **One-shot synthetic paid smoke**: a separate exact-approved model/account/contract/cost/session/scope (at most 10 JPY, one model/one POST, one hour, no retry) followed by independent zero-residue audit and qualitative result review.
5. **Phase 2 completion**: compare real output accuracy and author-review behavior, record cost, privacy and access-boundary results, obtain explicit admin trial and later public release approvals.

## Strict boundaries
- The current Staging baseline OFF/zero is point-in-time and not a posttrial zero-census, not evidence that an independent watchdog is running, nor authorization to enable AI.
- No new Preview, Staging mutation, JWT, paid AI, secret modification, workflow dispatch, live cleanup, or other Production mutation was performed.
- This PR alone requires exact HEAD OWNER approval for main Squash Merge; the repository's existing automatic Vercel Production build may follow that merge.
