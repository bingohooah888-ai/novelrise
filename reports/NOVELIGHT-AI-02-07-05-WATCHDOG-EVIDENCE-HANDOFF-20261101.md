# NOVELIGHT AI 02-07-05 — Dormant Watchdog Evidence Handoff

Base main SHA: `9b46565a7c0fb290d08fc7fb71619b260510b3d2` (PR #2731 merged).

## Implementation
- Introduces a **pure offline** evidence handoff: `.github/staging-ai-02-07-05/watchdog-evidence-handoff.mjs`.
- Explicitly prevents the GitHub Actions terminal status alone from being interpreted as a live watchdog or cleanup authorization. If the independently observed heartbeat is absent, the output is `INDEPENDENT_HEARTBEAT_MISSING` with zero proposed actions. If the workflow exit is not proven, the output is `RUNNER_EXIT_NOT_VERIFIED`, also with zero actions.
- When a complete synthetic evidence set matches exactly, delegates to the previously reviewed OWNER ledger + recovery + watchdog admission core. Requires exact repo, Staging project ref, workflow, main SHA, run ID/attempt, OWNER approval ID, Preview, actor, novel, episode and contemporaneous observation windows. Refuses self-declared paid/cleanup/heartbeat proof on the GitHub record itself.
- Even in a synthetic orphan situation, all outputs are advisory-only with `authorizesMutation:false`, `authorizesPaidCall:false`, `noPaidRetry:true`, `requiresSeparateOwnerApproval:true`.
- Synthetic tests cover absent heartbeat, active worker, stale heartbeat, terminal but recent heartbeat, expired/wrong scope, unclaimed and consumed ledger, cleanup residue and no-op, and malformed comments.

## Still missing; NO-GO
- **This pure function cannot authenticate that its JavaScript input objects originated from GitHub, an actual independent controller, or Staging.** A `kind` field and `controllerRunId` are structural contracts, never authentication. No live proof of runner/process termination, independent heartbeat, verified synthetic state or cleanup is claimed.
- Current GitHub Actions Staging trial workflow is OFFLINE/PREFLIGHT ONLY. A separately authorized out-of-process trusted controller, authenticated read-only heartbeat and Staging census adapters, independent emergency stop and verified cleanup are missing.
- **No actual watchdog is deployed or scheduled; no Github workflow dispatch, Preview, Staging mutation, migration, real JWT, paid provider call, AI enablement, secret processing or manual Production mutation.**
- A separate exact-HEAD `本番承認` is needed before merging this code-only PR; the usual automatic Vercel Production build may follow. No approval can be reused for a paid trial.
