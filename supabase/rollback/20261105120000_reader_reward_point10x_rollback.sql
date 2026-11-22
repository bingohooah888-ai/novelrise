-- NOVELIGHT βPoint x10: reviewer-visible rollback artifact.
-- The trusted workflow NEVER executes this file: it always wraps migration
-- plus pre/post checks in its own BEGIN ... ROLLBACK transaction.
-- This manual-only check must not be mistaken for committed migration recovery.
ROLLBACK;

-- Under the pinned old Staging snapshot, these checks MUST stay true after
-- the trusted outer transaction has been rolled back. Otherwise fail closed.
DO $nl10_after_rollback$ BEGIN
  IF (SELECT count(*) FROM public.scout_point_ledger) <> 3581
    OR (SELECT count(DISTINCT event_key) FROM public.scout_point_ledger) <> 3581
    OR (SELECT coalesce(sum(point_value::bigint),0) FROM public.scout_point_ledger) <> 3581
    OR (SELECT count(DISTINCT user_id) FROM public.scout_point_ledger) <> 1605
  THEN RAISE EXCEPTION 'NL10_ROLLBACK_LEDGER_NOT_RESTORED'; END IF;
  IF (SELECT count(*) FROM public.scout_badge_definitions) <> 182
    OR (SELECT coalesce(sum(point_reward::bigint),0)
        FROM public.scout_badge_definitions) <> 835
  THEN RAISE EXCEPTION 'NL10_ROLLBACK_BADGE_REWARD_NOT_RESTORED'; END IF;
  IF (SELECT count(*) FROM public.scout_badge_definitions
       WHERE (badge_id='reader_point_100' AND target_value=100)
          OR (badge_id='reader_point_500' AND target_value=500)) <> 2
    OR (SELECT count(*) FROM public.user_scout_badges
        WHERE badge_id IN ('reader_point_100','reader_point_500')) <> 12870
    OR (SELECT coalesce(sum(progress_value),0) FROM public.user_scout_badges
        WHERE badge_id IN ('reader_point_100','reader_point_500')) <> 7162
  THEN RAISE EXCEPTION 'NL10_ROLLBACK_BADGE_PROGRESS_NOT_RESTORED'; END IF;
  IF md5(pg_get_functiondef('public.novelight_award_level_up_points()'::regprocedure))
    <> '830b9784d2e7d5bdd71054188aa06e91'
  THEN RAISE EXCEPTION 'NL10_ROLLBACK_WRITER_FUNCTION_DRIFT'; END IF;
END $nl10_after_rollback$;

-- Full-row equivalence is separately verified by trusted-main fingerprints
-- against the independent backup before and after the rollback-only proof.
