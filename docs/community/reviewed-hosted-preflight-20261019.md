# Community Hosted Read-only Preflight — reviewed candidate binding (2026-10-19)

**Scope:** One existing OWNER-only, trusted-main, read-only workflow and its validation test. No hosted executor or cost path is enabled.

The previous preflight gate pinned the retired Phase 1 PR #2222 HEAD and would reject every main-only safety sync. The replacement checks the caller's exact `mainSha` and `featureSha` against fresh GitHub main and the open Draft PR, then validates the full immutable 37-file path / status / Git-blob manifest through `assertReviewedCommunityCandidate` using the repository's trusted GitHub compare. It refuses all partial, divergent, missing, extra, renamed or modified file proofs. The live Issue #188 must also be open; the Issue remains closed in reality.

The verification returns `READ_ONLY_PREFLIGHT_ONLY`, `requiresSeparateStagingApproval=true`, and negative flags for resource creation, Preview, browser and Production mutation. The workflow still has read-only permissions and no secrets, claims, migration, deployment, or expensive environment operation.

**NO STAGING AUTHORIZATION:** This change is an improved identity check for a dormant read-only preflight. It does not enable old hard-pinned hosted executor, pre-cost, claim/consume, hosted-write or shared-Staging interaction workflows. Hard spending limits, real GitHub Environment protections, isolated Staging management identity, migration parity and hosted two-user/admin cleanup evidence remain unproven.

Merging this code into main is a distinct Production change requiring separately scoped `本番承認`. Preview, Staging writes, Project creation and PR #2222 merge are excluded.
