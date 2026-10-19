# Community Phase 1 — candidate SHA review (2026-10-19)

Preparation-only scope: update nine trusted-main candidate pins and eleven corresponding offline test fixtures from retired candidate `6bf0ea608183e4977fcdaa17d36b1712974d5a49` to Draft PR #2222 candidate `91114a536688411caa37a5640a14eca01c8e0335` based on main `d70196d93e67058284f9d45b9f4d0d9d8b9c9b46`.

- This draft is **NOT a staging approval or production merge approval**.
- All exact main SHA checks, GitHub OWNER checks, one-use ledger CLAIM/CONSUME checks, protected staging environment requirements, fixed Staging project identity and default-deny tests remain mandatory.
- GitHub Issue #188 remains closed. Do not reopen it for this change. Do not dispatch workflows, create Preview, Supabase branches, perform DB writes, or execute CLAIM/CONSUME.
- GitHub Issue #294 remains a separate staging-only control. The ordinary `本番承認` is not a `ステージング承認`.
- No independent proof yet of provider-enforced spending hard stops, GitHub Environment protection, authenticated isolated staging project ownership, or real-user/admin acceptance and cleanup.
- The shared Staging migration history still requires a separate read-only compatibility review; do not repair it by migration writes or branch resets.
- Rebind is an exact immutable SHA lock; any change to the PR #2222 head invalidates this candidate lock. Never automatically substitute later heads.
- An approved reviewed main merge would only install safer contract code. It would not grant a run, open an issue, enable any feature flag, migrate Production, or publish the plaza.

Evidence: PR #2222 Node, static, RLS/rollback, mocked desktop/mobile browser E2E and CodeQL succeeded at the referenced head; merge-readiness remains intentionally blocked without a separate later high-risk Production approval.
