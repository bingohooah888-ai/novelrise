# NOVELIGHT Community Plaza Phase 1 — staging verification route preparation

**Status: design and read-only preflight prepared. Not activated. No Staging/Preview request sent.**

## 1. Scope and immutable inputs

- Repository: `bingohooah888-ai/novelrise`
- Candidate: Draft PR **#2222**, `feat/community-plaza-phase1-20261014`
- Approved-to-prepare only; NOT approved to touch Supabase Staging or Vercel Preview
- Canonical SQL: `supabase/migrations/20261014052000_community_plaza_phase1.sql`
- Existing Production Supabase ref: `fiepaguycecrredwrcwx` (absolute deny)
- Dedicated Staging ref observed earlier: `wmlzjgvxgoyrovdhbqbg` (identity must be reverified immediately before any future execution)
- OWNER approval ledger: **Issue #294** for DB operations; **Issue #188** for Preview
- Required: fresh exact `mainSha` and immutable `candidateSha`; no branch-name-only execution
- The intended validation must be read/modify/revert isolated Staging **only after** a separate, exact-target, one-time user **「ステージング承認」** and an installed OWNER ledger-driven pathway.

## 2. Current hard blocker

The production-authorized `supabase-staging-sync-request.yml` and
`supabase-staging-sync.yml` only accept a migration **already on the
current main**. The Phase 1 SQL is on an unmerged Draft PR.

Consequently, **do not invoke that sync for #2222**. Do not use direct
Supabase MCP `apply_migration` or `execute_sql` on Staging as a substitute.
Do not copy candidate migration into main, relax required status checks,
alter the STAGING project ref, or merge this PR just to unlock Staging.

A future candidate-bound verification route is a new security boundary and
needs separate security review and deployment authorization. A workflow
committed only to this PR branch would not be an installed safe default-branch
Issue #294 route.

## 3. Prepared offline check (no network or database access)

Run using **freshly retrieved** GitHub SHAs in a workspace containing the
Draft PR candidate:

```sh
node scripts/community-staging-preflight.mjs <CURRENT_MAIN_SHA> <EXACT_PR_HEAD_SHA>
```

The script verifies all seven candidate files and rejects missing
pre/post/rollback artifacts or migrations that enable `public_enabled`.
It only prints a preparation manifest showing `canExecuteStaging=false`.

**Limits:** this script does not verify commit ancestry, current remote
branch state, Staging credentials, migration ledger, hosted RLS, or owner
identity. Those are mandatory checks in a separately authorized execution
route and must never be inferred from a PREPARATION_ONLY result.

## 4. Proposed OWNER-controlled isolated verification (NOT installed)

A later owner-approved candidate route must, before accessing secrets:

1. Receive one immutable `mainSha`, `candidateSha`, one migration version,
   a declared Staging-only scope, and an explicit one-time approval under
   the existing fixed Issue #294 control.
2. Verify caller is the repository OWNER and that an Issue #294 claim/
   consumed marker for this request comment does not already exist.
3. Re-read current main and PR head; require exact SHA equality and that the
   candidate is descended from current main. Reject changed/merged/closed PR.
4. Prove the candidate contains **only** the expected migration/check/rollback
   content for DB execution. Do not run arbitrary candidate PR code or
   GitHub Actions steps with Staging credentials; the verified runner must
   come from a trusted owner-approved revision. Pin external actions by SHA.
5. Require `environment: staging`, `PGSSLMODE=require`, Staging resource
   identity verification, and absolute Production project-ref denial **before**
   any data operation; use dedicated Staging credentials only.
6. Check current migration history, require precisely the expected pending
   candidate and baseline schema compatibility. If history is not aligned,
   STOP; never bypass/repair the migration ledger automatically.
7. Claim the one-time approval in Issue #294 **before mutation**. Then
   run approved precheck, apply the single candidate, run postcheck and
   cross-user/role/mute/moderation tests against controlled test identities.
   During tests keep `community_runtime_control.public_enabled=false`
   unless within a verified safe test-only sandbox/session.
8. Record test results, pending/parity state, and recovery requirement in
   Issue #294. Never silently run destructive rollback on hosted Staging.
   Mark the attempt consumed even on failure, with no retry reuse.

Issue #188 and an **independent** one-time Staging authorization are required
for a Vercel Preview. Browser preview tests are not in this preparation scope.

## 5. Release gates and stop conditions

- Current state: PR Draft, unmerged; database gate OFF in candidate;
  public UI flags OFF; no Staging/Production mutations.
- Successful disposable CI replay is **not** hosted Staging verification.
- The path cannot move beyond PREPARATION_ONLY without reviewed
  candidate-bound owner approval control installed through the lawful
  repository security change process. Installing it may itself require
  「本番承認」 if a main merge triggers Production deployment.
- Even successful Staging validation does not authorize Production
  migration, main merge, enabling `community_runtime_control`, or public UI.
- Fail-closed if main moves, PR head changes, resources differ, ledger is
  stale, schema parity drifts, owner authorization cannot be established,
  a secret is missing, or a callback tries to reuse a consumed approval.

## 6. Remaining work

- Review the design for a trusted, candidate-SHA-bound Issue #294 executor.
- Establish an authorized installation mechanism **without** making an
  unapproved Production mutation.
- Independently authorize exactly one Staging run (actual words:
  **「ステージング承認」**) after identifying the immutable target and scope.
- Run Staging role/RLS, consent, audit, notifications, restore/disable tests.
- Separately obtain 「本番承認」 before merge or production mutation.

## 7. 2026-10-22 hosted ledger-divergence inspection (read-only)

Hosted management and SQL retrieval was repeated. This dated snapshot is
**not** a migration request, execution permit, or live 3-role acceptance result.

| Source | Recorded migrations | Community 20261014052000 | New author activity migrations |
| --- | ---: | --- | --- |
| Production fiepaguycecrredwrcwx | 189 | Absent | 20261022010000, 20261022010100 |
| Staging wmlzjgvxgoyrovdhbqbg | 188 | Present once | Both absent |

- Production-only: author_activity_publication_timestamps (20261022010000)
  and author_activity_first_episode (20261022010100).
- Staging-only: community_plaza_phase1 (20261014052000).
  Common migration versions and names matched in the retrieved lists.
  **The migration ledgers are not equivalent.**
- Staging branch management reported MIGRATIONS_FAILED while preview project
  health reported ACTIVE_HEALTHY. These are distinct states; neither permits a write.
- A read-only Staging SQL query found public_enabled=false, activated_at=null,
  and zero community comments or notifications.
- The user's recent 本番承認 does not include a new ステージング承認.
  Issue #188 is closed. Issue #294 accepts only installed trusted-main routes,
  while this draft candidate is ineligible for the existing main-only sync.
- Do not reset/rebase Staging, edit the ledger, force-sync migrations,
  create billed isolation, or deploy a Preview without new scoped approval.

The offline inspectCommunityStagingLedger helper in
scripts/community-staging-preflight.mjs accepts only explicitly complete
migration snapshots and fixed production/staging identities. It reports
production-only, Staging-only, and renamed-version conflicts, and rejects
missing, duplicated, malformed, or incomplete inputs. All results keep
canSyncOrReset=false, canRunHostedAcceptance=false, and
canMergeOrDeployProduction=false; this helper cannot prove host authenticity,
snapshot freshness or approval. Tests model the observed divergence as a
fixture; those tests do not touch hosted Supabase.

**Next safe boundary:** establish a reviewed trusted-main one-use runner
bound to immutable candidate artifacts; verify isolation cost, budgets and
cleanup, and obtain exact-scope ステージング承認. Test separate authenticated
users A and B plus staff, including direct RPC cross-ownership, blocking,
muting, reporting, moderation and notification isolation. Then revisit
Production merge, schema migration and public activation as separate
release decisions; do not infer permission from offline checks.

## 8. 2026-10-22 hosted RPC-definition drift (read-only)

Additional pg_proc / to_regprocedure checks in dedicated Staging prove
that the migration version being recorded is **not** proof that its
currently deployed SQL matches the latest Draft PR candidate.

The following six RPC signatures are present in the candidate migration
but **absent** in the actual Staging public schema at the inspection time:

- novelight_community_comment_detail(text, uuid)
- novelight_community_edit_my_comment(uuid, text)
- novelight_community_delete_my_comment(uuid)
- novelight_community_report_comment(uuid, text)
- novelight_community_mark_notifications_read(bigint[])
- novelight_admin_community_dismiss_report(uuid, uuid)

By contrast, novelight_community_my_notifications(integer) and
novelight_community_post_comment(text, text, uuid) were found.
All eight Staging community_% tables had RLS enabled and no anon
SELECT, authenticated SELECT, or authenticated INSERT table grants.
Admin moderation and metrics RPCs were service-role-only in the
Staging privilege snapshot. These grant observations do **not** replace
live authenticated cross-user or IDOR testing.

**Additional hard blocker:** Staging is an older Phase 1 schema snapshot
under the same migration version. Do not treat it as the current PR's
hosted acceptance target, attempt a repeat of the applied version,
manually alter migration history, or auto-rebase/reset the branch.
Future approved isolated acceptance must use the exact reviewed candidate
schema from a clean known baseline; any shared-Staging reconciliation
requires an independently reviewed additive migration/ledger plan.
