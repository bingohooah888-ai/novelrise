# Internal work Rank operations — no star ratings

Effective after the explicitly approved `20261027090000` production migration. The migration is a **candidate** until approval and deployment.

## Invariants

- Only the two authoritative signals contribute: qualified distinct readers from `valid_read_events`, and distinct non-author favorites from `favorites`.
- Absolute thresholds stay at (50,2), (200,8), (800,30), (3000,100), (10000,300) for Rank 2..6.
- Normalized percentile weights remain 20:35, i.e. 20/55 and 35/55.
- Relative bands, rank stability windows, inactivity decay, completion/final rank, historic seed snapshots, Scout rewards and beta Rank privacy are unchanged.
- Rating-only badges are retired; prior reader/author SCOUT histories are not cleared. Rank 5's proper name `STAR` is **not** a reader star rating.
- No manual backfill on migration, to prevent uncontrolled discovery/reward processing.

## Scheduler and evidence

- PostgreSQL Cron job: `novelight-recalculate-work-ranks`.
- Frequency: every hour at minute 15 (Postgres cron timezone).
- Action: `select public.novelight_recalculate_work_ranks();`; it is a privileged private DB operation.
- Health checks: `cron.job_run_details` must show `succeeded` and all published active `novel_rank_state.last_evaluated_at` timestamps should advance within 2h.
- Candidate rank waiting for 24/48/72h or 7 days is normal; unchanged current ranks do not indicate a stalled evaluator.
- Deleted-work Rank snapshots stay for historic SCOUT/seed audit. Never count all `novel_rank_state` rows as currently published.

## Failure response

1. Query the postcheck and `cron.job_run_details` (read-only).
2. If a run failed, inspect its error without repeatedly invoking the evaluator manually.
3. Recheck current DB functions, privilege grants, row locks and query plan.
4. Correct the cause in a work branch; production mutation and merge still require explicit approval.
5. If restoring the star-based historical version is necessary, use the preserved original migrations and a reviewed rollback procedure, **not** an unguarded replay or destructive reset.

Do not run a one-time evaluator or mass-update Rank for diagnosis: Rank changes can trigger LIGHT SEED discovery and SCOUT reward processing.
