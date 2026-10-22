# Community Plaza Phase 1 — Staging Forward Reconciliation

**Preparation only. No Staging or Production mutation is authorized by this document or a PR merge.**

## 2026-10-22 evidence (read-only)

- Source: Draft feature PR #2222, candidate migration blob
  `df651446da99e299005b4c8ec262c528bf477922`.
- Dedicated existing Staging ref `wmlzjgvxgoyrovdhbqbg`; never Production
  `fiepaguycecrredwrcwx`. Existing branch status `MIGRATIONS_FAILED`,
  project `ACTIVE_HEALTHY`.
- Existing routine baseline: 19 community/related functions (including
  LIGHT SEED share routines), deterministic catalog MD5
  `ccd2c2b8c66f3b9fa025b0163d75b156`.
  The trusted workflow and atomic guard both reject function-body drift
  before replay so later edits cannot be overwritten silently.
- Ledger: exactly 188 migration versions; version `20261014052000` is
  **already recorded exactly once**. Sorted comma-joined ledger MD5:
  `3851f0dfc1e5bdb6bc7c0e317c5c4fd4`.
- `community_runtime_control.public_enabled=false`,
  `activated_at IS NULL`; Community rows, notifications, moderation rows
  and author/list consent rows are all zero.
- `community_comments.edited_at` and six newer RPCs are missing.
  Reapplying the old `migration-sync` or `community-phase1-persist`
  workflows is invalid: they require an unrecorded candidate migration.
- PR #2222 may move after this review. The reviewed migration **Git blob**
  must remain unchanged, and the exact HEAD must be approved fresh.

## Proposed one-time authorized path

1. Independently review and approve the **trusted-main workflow installation**
   PR. Merging a GitHub workflow to main is a separate Production boundary;
   it cannot be authorized by a generic Staging approval alone.
2. Before execution, recheck current main, Draft PR #2222, exact HEAD
   descendant, pinned candidate SQL blob and Issue #294 one-use ledger.
   Confirm required project secret and Staging-only connection.
3. Obtain **fresh Staging approval for this exact HEAD and scope** through
   repository OWNER Issue #294. The workflow accepts only
   `community-phase1-forward-reconcile` and its strict JSON contract.
   No previous approval comment can be reused.
4. Run the workflow from trusted main. Download only the pinned SQL data blob
   from PR #2222. Never run untrusted candidate scripts with Staging secrets.
5. In a **single PostgreSQL transaction**, check the entire reviewed ledger
   fingerprint, no community data/consents, OFF gate, and old missing-column
   fingerprint; add `edited_at` and replay the reviewed idempotent migration
   body. Require six missing RPCs and no prohibited grants after execution.
   On any error the transaction rolls back. **Never modify the migration
   history table.**
6. Recheck the ledger, public gate, required RPCs and absence of unexpected
   data after the transaction. Record `CLAIMED` and `CONSUMED` in the
   Issue #294 audit ledger even if the run fails.

## Deliberate exclusions

- No new Supabase project or branch, no Vercel Preview build, no public
  activation, no Production DDL, no feature PR merge, and no reuse of a
  consumed OWNER approval.
- Staging SQL reconciliation alone does **not** prove hosted browser flows.
  The later 2-user + admin authentication/moderation acceptance and R15/R18
  boundary checks need their own reviewed runtime harness and authorized
  scope. Issue #188 Preview cost gate is presently closed; do not reopen it
  implicitly.
- A branch marked `MIGRATIONS_FAILED` must **not** be reset/rebased or
  have its schema-migrations ledger fabricated to force parity.
- All Staging changes must remain isolated from Production and leave the
  Community feature OFF until a separate release gate passes.

## Failure policy

A mismatch in HEAD, main, migration Git blob, ledger digest, user-generated
rows, consent, OFF gate, RPC baseline or permissions means **stop before
writing** (or roll back if detected transactionally). A failed one-use run
must not be retried using the same approval. Investigate via read-only
inspection, amend reviewed code and request new scoped authorization.
