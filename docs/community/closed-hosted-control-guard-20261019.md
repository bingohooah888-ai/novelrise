# Community Hosted — closed Issue #188 safety gate (2026-10-19)

This security-only Draft PR adds two checks to four existing Hosted workflows:
1. An `issue_comment` event for Issue #188 must declare `issue.state == 'open'`.
2. Before any downstream steps, a **fresh GitHub API issue snapshot** must also have `state == 'open'`.

Both event-time and read-time checks deny closed or stale events. The four workflows are: preflight, pre-cost inspection, executor pre-CLAIM inspection, and the callable one-use CLAIM audit. The latter can create a Git reservation, but receives no Staging grant and now additionally refuses a closed control issue.

No workflow trigger, role, token, environment, approval identity, billed provider, Supabase setting, Vercel deployment, issue state, or feature flag is otherwise changed. The existing exact-candidate retired SHA remains untouched and fail-closed. This PR does not enable hosted write flows.

**Current Issue #188 is closed**. It must stay closed until separately approved one-use cost and environment gates are independently proven. CI + CodeQL validation is not `ステージング承認`. Merging to main is itself a Production mutation requiring explicit `本番承認`. PR #2222 stays Draft.

Related unresolved blockers: independently enforced GitHub Environment restrictions, provider hard spending stops, Staging identity access, 1-migration-each-way shared Staging drift, real authenticated two-user/admin interaction tests, and verified cleanup.
