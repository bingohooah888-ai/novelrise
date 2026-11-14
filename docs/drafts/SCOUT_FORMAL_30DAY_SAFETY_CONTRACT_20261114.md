# SCOUT formal 30-day review safety design — DRAFT / DO NOT APPLY

This is **Markdown-only**, non-executable SQL design. **No migration,
secret, workflow, scheduler, XP writer, or review RPC is being deployed.**
The current Runner must remain disabled. Real Staging concurrency is unverified.
The legacy `review_scout_30_days` does not prove XP source finality or
cross-writer serialization and must NOT be a Runner execution target. The
Runner now references only the future private `review_scout_30_days_sealed`
and `list_due_scout_30_day_reviews` contracts, neither installed nor
approved. Their absence keeps execution fail-closed. No database functions
are installed or changed by this PR.

## Proposed shared transaction lock (NOT IMPLEMENTED)

All XP ledger **INSERT**, **UPDATE**, **DELETE**, correction, and backfill paths
must share one per-reader transaction lock, including read, comment, LIGHT SEED,
discovery, and direct privileged writes. Lock both user IDs in deterministic order
on user transfers. The review must acquire this lock before the level state row.

```sql
-- DO NOT APPLY. Draft quotation, not a migration.
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'novelight:scout-formal-xp-review:v1:' || p_user_id::text, 0
  )
);
-- Review order: shared lock -> scout_level_state FOR UPDATE
-- -> fresh snapshot (READ COMMITTED) -> sealed XP sum -> unique claim.
```

A new BEFORE trigger alone is not enough: existing beta trigger
`novelight_cap_scout_xp_beta` can RETURN NULL before XP is stored.
Audit parent-event trigger timing and all existing seed/state locks to avoid
inversion and deadlocks. The XP writer must hold the shared lock through the
source event transaction COMMIT, not just its SELECT.

## Period seal, historical XP, and correction policy (NOT IMPLEMENTED)

Review a fully complete `[start, end)` window only after database-backed
**seal** and a committed source-event watermark. A boolean from a client or
an offline mock is not verification. Incomplete/late XP, historical timestamps,
negative corrections, retry backlogs and uncommitted writers make the decision
**HELD** (fail-closed) with no demotion.

Late XP after seal must be persisted durably with a unique source key into
a correction queue; no silent rejection or partial commit. Restoration,
compensation, notifications and ownership of `occurred_at` are **not approved**.
Do not implement a working seal until those decisions are settled.

## Beta-to-formal cutover (NOT IMPLEMENTED)

`novelight_cap_scout_xp_beta` presently restricts XP and returns NULL for
`light_seed_discovery`; the live rank trigger uses a state-only path.
Formal review remains blocked until beta cap replacement, discovery XP
source wiring, historical reconciliation, idempotent migration, and
a rollback plan have been approved and independently verified.

## Proposed least-privilege due-user RPC (NOT IMPLEMENTED)

A future `novelight_formal_private.list_due_scout_30_day_reviews` may return
at most **25** due UUIDs, server-time verified, stable oldest-first ordering,
read-only and no client-controlled search space. Require:
- Unexposed private schema, narrow dedicated NOLOGIN owner, audited
  **SECURITY DEFINER** use and fixed empty `search_path`;
- Fully qualified SQL names, EXECUTE revoked from PUBLIC, anon and
  authenticated; allow only verified server role;
- **No GRANT SELECT** on private state to `service_role`;
- Runner code now targets this future private due RPC, with no direct table
  SELECT; execution remains blocked until separately approved.
- Future `review_scout_30_days_sealed(uuid,timestamptz)` must atomically
  acquire the common XP-writer transaction lock, prove trusted source finality,
  hold on uncommitted/late/corrected XP, verify beta-to-formal cutover and
  enforce the unique review claim. An unverified window must return a
  non-writing `held` result rather than demoting.
- The server must never fall back to the legacy unsealed
  `review_scout_30_days` RPC.

Existing Staging has `service_role` RPC EXECUTE but lacks private state
SELECT, and the Runner currently reads that table directly; both are
explicit unresolved blockers. Until all approvals, hard-disable the Runner.
