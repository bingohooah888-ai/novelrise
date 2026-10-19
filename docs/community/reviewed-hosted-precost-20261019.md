# Community Hosted — pre-cost read-only identity review (2026-10-19)

**DRAFT / unapproved for Production merge.** Updates **only** the dormant read-only Hosted pre-cost proposal inspection. The work remains fail-closed and cannot allocate resources.

The existing shared legacy pre-cost verifier and write/CLAIM coordinator are UNCHANGED and keep their retired SHA lock. A new, separate `community-hosted-precost-review-only.mjs` verifier is used solely by the no-cost inspection workflow, replacing the old fixed SHA within that independent read-only proposal checker with a fresh exact owner-supplied main/candidate pair and the existing reviewed 37-file manifest. A trusted-main GitHub compare must show `ahead`, `behind_by=0`, exact base/HEAD and every reviewed path/status/Git blob, without extras. Both the event Issue #188 and fresh GitHub API Issue #188 must match and remain open; #188 is currently CLOSED. The one-use ledger, OWNER-only event control and run identity are unchanged. Invalid or stale candidates reject.

All outputs explicitly remain `OWNER_PRE_COST_PROPOSAL_PREPARATION_ONLY`, `stagingCostApproved=false`, `mayClaim=false`, `mayCreateBranch=false`, `mayDeployPreview=false`, `mayRunBrowser=false`, `runAuthorized=false`, and `releaseAuthorized=false`. This cannot be used as a Stage execution authorization.

**NOT changed:** Workflow permissions (read-only), triggers, secrets, environments, Vercel Preview, Supabase, Production DB, claims, paid execution, existing legacy **write** SHA pins or rollback scripts, or Issue state. Independent GitHub Environment protections and provider-enforced hard spending limits have not been verified. Shared staging has unmatched migrations `20261014052000` and `20261018120000`. Do not reopen #188 or authorize Staging based on this preflight.

Only a narrowly scoped `本番承認` would authorize merging this safety-only draft PR. A separate `ステージング承認` and independently proven isolation, billing caps, migration parity, and cleanup are required before *any* cost-bearing Stage operation.
