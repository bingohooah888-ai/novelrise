# November 2026 contest — stage 08 immutable ranking snapshots (Draft)

**Unapproved new migration:** 20261013194500. Stage 07 is in Production,
but points recording and entry acceptance are deliberately OFF. This phase
must not publish or enable the contest.

The fixed ranking slots are 2026-11-07 / 15 / 22 at **12:00 JST** (03:00 UTC).
All calculation is contest-only and wholly separate from normal PV, SCOUT
RECORD and LIGHT SEED. 3 / 5 / 10 distinct qualified episodes yield replace-only
1 / 3 / 5 points per reader/work. Review-held, merged and excluded readers
and invalid event statuses contribute no credit. Public general-zone ranking
includes general / R15 human and AI-assisted published eligible works; R18 and
AI-generated-zone works never enter the public list. A user may hide R15 works.

The existing private rank_snapshot + rank_row tables are used; no new table
is introduced. Service-role-only "prepare" captures a top-10 read-only
snapshot. A separate service-role-only "publish" refuses to publish before its
exact slot, before the snapshot is recomputed at that slot, when hidden, or
after contest end. A published snapshot is immutable. Public RPC returns only
the most recently published scheduled snapshot, with title, novel link,
rank, points and qualifying reader count. Nothing is shown in draft or
before the first permitted publication, and no personal reader/author
identities, audits or payout records are exposed.

**Important:** automated scheduling/cron and the operator's publish approval
workflow are **not yet wired**. Preparing a draft does NOT publish. Running an
old snapshot creator before scheduled noon cannot publish later, preventing
stale points. No code switches Production contest to active, and there is
no transfer of cash/awards. Published ranks are provisional only; 0-point
awards are prohibited elsewhere and equal-point *final* prize decisions
remain separate. Reader fraud adjudication and final 12/1 ranking also
remain separate.

The new SQL is validated only on disposable PostgreSQL CI and has a
manual rollback that refuses to erase published history. Preview/Staging,
Production DB, Vercel deployment and activation remain approval-bound.
