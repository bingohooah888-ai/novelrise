# NOVELIGHT βScout Point10倍 — 第3.5段階の実行入場境界（レビュー専用）

**Status: OFFLINE CONTRACT ONLY / NO-GO for Staging SQL, Production SQL and all database mutations.**

## Authoritative scope

- Base main: `724f594ab8733f4a15ac4523900f59552bb9c11a`; MASTER Git blob: `91d11fa367b7de64990b13397b13d4bb6e3c0230`.
- Existing Supabase Production: `fiepaguycecrredwrcwx`; existing Preview Branch Staging: `wmlzjgvxgoyrovdhbqbg`. No new CONTROL or paid project.
- Existing exact proposal: `docs/plans/READER-REWARD-POINT10X-EXISTING-DB-ATOMIC-REVIEW-20261106.sql`. Its source must match SHA256 `325d1f9514186ba869a17514db0e54339c2fed4d4bd9eb296df2a764cd3dc23e`; it remains outside migrations and all active workflows.
- New **offline-only** helper: `scripts/scout-point10x-staging-cutover-adapter.mjs`. Its accepted evidence fields and fixed source digest are review gates, **not credentials, OWNER authentication, or read-write access**. `executeStagingCutover()` always HOLDs.
- Existing GitHub OWNER V3 workflow and read-only executor are **not** an approval for this scope. No changes to them; no reuse of prior OWNER comments, CONTROL CAS, or rollback scope.

## Minimum next-phase admission (current evidence is insufficient)

1. **Exact fresh-main OWNER event**: separate GitHub issue #294 `issue_comment.created` with newly approved scope `reader-reward-beta-point-tenfold-existing-db-staging-v1`, explicit run count one, exact reviewed main/SQL SHA and newly issued comment ID. A trusted-main workflow must verify GitHub REST identity/history/TTL/immutable payload. A shape-valid object is NEVER authenticated approval. Neither the existing read-only V3 event nor a ChatGPT message is a substituted event.
2. **At-most-once admission**: atomically consume the new authorization in a durable trusted store before any write connection. The current proposal's private `point10x_beta.unit_cutover` marker protects within one committed DB state, but cannot independently prove external approval consumption across restore or operator rollback. There is **no live CAS runner** in this stage. If reliable single-use admission cannot be provided without a new CONTROL, require another OWNER design decision rather than weakening the boundary.
3. **Staging-only connection proof**: independently bind the live branch identity and TLS host to `db.wmlzjgvxgoyrovdhbqbg.supabase.co` (or separately reviewed equivalent), verify current database and server fingerprint from the **same authenticated session**, PostgreSQL major >= 17, and conclusively reject `fiepaguycecrredwrcwx`. Supabase `list_branches` reports an active branch but `get_project(staging_ref)` previously returned `Project not found`. An offline claimed fingerprint cannot resolve this blocker.
4. **Independent recovery**: record a verifiably restorable Staging backup, successful restore to a _separate_ isolated destination, integrity proof, time, and rollback/forward-recovery decision. No backup or restore has been performed under this approval. A nonpersistent Preview Branch or schema-only seed is not a substitute for current data recovery.
5. **Writer fencing & resume**: before any lock or DML, enforce a reversible, complete, externally observable stop for application API, privileged/direct clients, triggers/RPC entrance, scheduled/cron jobs, queues/retries/workers and all service-role bypasses. Confirm zero in-flight transactions and block new sessions; register an incident-safe resume order. The current code has **not** stopped or proved any Writer.
6. **Locks, deadlines and version**: existing six-table `ACCESS EXCLUSIVE` locks block reads as well as writes. Reviewed SQL now adds `SET LOCAL transaction_timeout = '90s'` (PostgreSQL 17+), retaining `lock_timeout = '2s'` and `statement_timeout = '120s'`. A 2-second lock timeout is **not** a 2-second lock hold limit, and a transaction timeout can abort the session. Confirm current branch DB version and explain service interruption before approved execution.
7. **Atomic confirmation**: one SERIALIZABLE transaction, existing five value conversions, current 2026-09-28 beta RPC 5→50, target-only badge progress checks, old RPC ownership/ACL/SECURITY DEFINER and RLS checks, private marker in the same COMMIT. Verify Point, XP, thresholds, status and unaffected rows against independent fresh evidence. On any failure STOP, ROLLBACK where possible, preserve fence until state is known; COMMIT ACK unknown means **no retry** and first read the authoritative primary marker/ledger.
8. **Separate Staging approval**: a new exact HEAD/SHA-bound OWNER approval is required for real DB access, real writer drain, backup creation, restored rehearsal, credential/Secret usage and Staging transaction. Production operation requires another explicit approval. No gift exchange or AI Point spending.

## Implemented versus not implemented

- **Implemented in this Draft**: one hard-pinned SQL source, PostgreSQL 17 transaction deadline candidate, strict offline acceptance shapes for new-scope claim/Staging identity/fresh separate restore/all Writer classes/retry policy, and focused negative tests. No dependencies, workflow or runtime activation.
- **Not implemented / not evidenced**: live trusted-main OWNERSHIP verifier for the _new_ scope, durable one-use spend/CAS, authenticated Staging SQL connection, real backup or restore, actual Writer stop/resume, transaction timing under production-sized data, external audit and post-COMMIT Staging proof.
- Draft branch work only; Vercel project currently has `git.deploymentEnabled` false outside main. Any future main merge requires exact-HEAD Production merge approval and may trigger existing automated Production deployment. No main merge in Phase 3.5.

**Decision**: safe for source review and focused tests only; Staging cutover remains NO-GO. Do not interpret a passing test, an offline synthetic receipt or an authenticated OWNER read-only event as live execution authority.
