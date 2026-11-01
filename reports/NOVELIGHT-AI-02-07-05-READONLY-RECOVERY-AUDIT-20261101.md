# NOVELIGHT AI 02-07-05 — Offline read-only recovery consistency audit

Base main SHA: `b2242d77037bfbde31cd93e22371e419af7dc956`, after owner-approved PR #2727.

## Implemented
- `.github/staging-ai-02-07-05/read-only-recovery-audit.mjs`: offline-only combination of the previously merged **full GitHub OWNER comment ledger verifier** and the independently merged recovery **decision-only** contract.
- A caller's arbitrary `claimed`/`consumed` booleans cannot influence a recovery decision; those flags are taken strictly from an inspected GitHub Issue #294 ledger snapshot with exact approval ID, SHA, Preview, one-use run ID and bot/owner identity checks.
- Independent Staging census evidence must have the same exact project ref, actor, novel, episode, main SHA, Preview, approval, run ID and an observation timestamp within 30 seconds of the ledger snapshot.
- Returns advisory only, with `authorizesPaidCall:false`, `authorizesMutation:false`, `noPaidRetry:true`. A claimed-but-orphaned run proposes cleanup and one consumed tombstone. A consumed run with residue proposes cleanup, no second tombstone. An unclaimed run never authorizes an operation.
- Adds offline synthetic tests for consumed, orphaned, no-op, forged flags, cross-project/run/SHA, duplicate ledger and time skew.

## Important limitations / NO-GO
- No API, Actions workflow, JWT, Secret, provider, Preview, database or cleanup execution is added or activated.
- Inputs are synthetic unless an independently approved protected process supplies **authenticated live read-only** GitHub and Staging observations. This code does not authenticate origins and does not prove that any real Staging cleanup occurred.
- This PR does not implement out-of-process watchdog scheduling/stop, actual independent Vercel cleanup or final census. It must not be used to run a real paid trial without separate exact-SHA OWNER approval and upstream guarantees.
- A future exact-HEAD `PR 本番承認` would authorize only Squash Merge and ordinary automatic Production deploy, not any independent Preview, Staging mutation, JWT, paid API or AI enablement.
