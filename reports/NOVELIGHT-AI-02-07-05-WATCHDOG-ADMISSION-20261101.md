# NOVELIGHT AI 02-07-05 — Dormant Watchdog Admission Core (offline-only)

Base main SHA: `bf9f83b4d67e95d169451cd512ec2e62b4bbc7e7`; current date 2026-11-01 JST.

## Code delivered
- `.github/staging-ai-02-07-05/watchdog-admission-core.mjs`: pure, **non-executing** independent supervisor decision contract, composing the already merged GitHub OWNER Issue #294 ledger audit and independent Staging synthetic census recovery planner.
- Exact scope binding: GitHub repo, Staging project ref, main SHA, Preview ID, OWNER approval ID, GitHub run ID and single attempt, synthetic actor/novel/episode.
- Read-only runner observation must be within 30s of the ledger and census and represent a valid GitHub Actions status/conclusion. A running worker, even with a stale heartbeat, **never** receives cleanup advice without independently proven terminal status. A recently terminal worker requires re-observation.
- A verified terminal worker with stale heartbeat and unconsumed CLAIM can produce an **advisory** proposed cleanup list. CONSUMED with residue can propose cleanup but not a second tombstone; independently verified zero residual produces no-op.
- Tests use synthetic ledger/comment, runner and Staging evidence only.

## Explicit NOT wired / NO-GO
- No out-of-process watchdog job is deployed or scheduled by this PR. The module is an offline admission decision, **not a live watchdog**, nor independent evidence of runner termination or cleanup.
- No workflow, Preview, Staging, Auth, JWT, secret, AI provider, billable call, live stop or data deletion is connected or executed.
- Runner, ledger and census observations still require authenticated, independently audited read-only adapters and durable independent control-plane process. A Boolean `readOnlySnapshotVerified` is **a contract field supplied by a future trusted adapter, not real authentication**.
- No live paid trial is authorized or operationally ready. Future live cleanup requires exact-scoped OWNER approval, out-of-process control, deterministic cleanup and independent final zero-residue census.
- `PR 本番承認` for this PR would cover only the exact approved Squash Merge and ordinary automatic Vercel Production deployment, not any separate Preview, Staging write, real JWT, paid AI or AI ON.
