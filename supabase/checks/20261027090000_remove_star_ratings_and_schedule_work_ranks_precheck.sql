-- Read-only production preflight for the starless internal Rank migration.
select
 (select count(*) from public.novel_star_ratings) as historical_star_ratings,
 (select count(*) from public.scout_xp_ledger where xp_kind='star_rating') as star_xp,
 (select count(*) from public.user_scout_badges where badge_id like 'reader_rating_%' and earned_at is not null) as earned_rating_badges,
 (select count(*) from public.novels where status='published') as published_works,
 (select count(*) from public.novel_rank_state where last_evaluated_at is not null) as already_evaluated_works,
 (select count(*) from cron.job where jobname='novelight-recalculate-work-ranks') as prior_rank_cron;
-- All three historic-star counters must be 0; inspect if nonzero.
-- Do not run the evaluator to "test" preflight: it is stateful and can award SCOUT.
