# NOVELIGHT AI 02-07-05 — GitHub Runner Exit Double Snapshot

Base main: `090ffccb53f045fadf977e3cef8566b152cd66ec`. Scope: dormant read-only evidence hardening, 2026-11-01 JST.

## Confirmed issue and fix
- The prior GitHub Actions read-only runner observer fetched all jobs once, then checked only the workflow-run record again. A job status, conclusion, identity, ordering, or terminal timestamp might change after the first job list without any guaranteed atomic snapshot.
- This PR fetches **the entire paginated job list twice** and compares each job's ID, workflow run ID, run attempt, SHA, state, result and timestamps in order; changed job count or page shapes fail closed. It re-reads the workflow run after BOTH job snapshots and rejects run-state transitions.
- Synthetic tests cover stable snapshots and changed second-pass job state, ID, completion time or attempt.
- Network calls are GitHub GET only, fixed repo/path with redirect disabled; there is no code that writes GitHub, Supabase or Vercel or calls AI.

## Important limitations
- Independent GETs are not a distributed atomic transaction. Even matching double reads cannot prove no changes occurred immediately after the second read. The future controller must independently establish freshness, OWNER scope and heartbeat, and must not treat this code as authorizing cleanup or a billable AI attempt.
- GitHub workflow termination is **not** proof that an AI provider was called, that a synthetic actor or Staging project was used, or that cleanup and zero-residue verification succeeded.
- Existing AI trial workflow remains offline-preflight-only. No Preview, Staging write, JWT, paid provider, AI enablement, external watchdog, workflow dispatch or Production mutation is performed or activated.
- A fresh explicit exact-HEAD PR merge approval is required; an ordinary automatic Vercel Production build may follow an approved squash merge.
