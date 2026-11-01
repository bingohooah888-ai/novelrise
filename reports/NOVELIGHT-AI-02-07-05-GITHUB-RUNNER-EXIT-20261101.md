# AI 02-07-05 — Read-only GitHub Actions Runner Exit Observer

Base main: `efd934a9ff7c275cb49ddceedc66812d31e50cec` (PR #2729 merged). 2026-11-01 JST.

## Scope
- New dormant module `.github/staging-ai-02-07-05/github-runner-exit-readonly.mjs`. It reads only fixed-host GitHub Actions REST GET URLs for one exact-numbered run and all its jobs, followed by a second workflow run read to reject status transitions.
- The caller must inject a separately authorized least-privilege `actions:read` token from a protected independent control plane; neither credentials nor requests run at import time. No requests are dispatched by existing CI or workflows.
- Validates workflow path exactly `.github/workflows/ai-020705-owner-staging-paid-trial.yml`, exact repo/main SHA, workflow_dispatch, OWNER actor + triggering actor, run_attempt=1, job SHA/id/attempt and all job status/conclusion combinations. Incomplete or internally inconsistent evidence fails closed.
- Provides `terminalRunnerExitVerified` only if GitHub says workflow and all jobs are completed. Never treats merely outdated workflow updates as a true liveness heartbeat. Explicit `independentHeartbeatVerified:false`, `syntheticScopeVerified:false`, `cleanupVerified:false`, `noPaidRetry:true`, `authorizesMutation:false` and `authorizesPaidCall:false`.
- Added synthetic, injection-only offline tests for completed/active/mismatched/re-run/cancelled/stale page and sanitized errors.

## Precise limitations / NO-GO
- This module does **not** prove that GitHub Actions performed a paid Staging trial. The current OWNER trial workflow remains **OFFLINE PREFLIGHT ONLY**; its completion cannot be used as a paid-model test receipt.
- GitHub workflow status cannot verify the exact OWNER approval ID, Preview, synthetic actor/novel/episode, Supabase project, environment reviewer, independently recorded heartbeat, final cleanup or zero-residue census. Those require other trusted adapters and an out-of-process watchdog.
- A separately reviewed and approved future orchestrator could combine authenticated GitHub ledger, Staging census, heartbeat and runner exit evidence, but **this PR neither connects them nor grants any runtime authority**.
- No Preview, Staging write, real JWT, provider/AI call, AI enablement, secret handling, external job dispatch, migration or Production mutation is authorized by this PR. Exact-HEAD Squash Merge requires independent `本番承認`.
