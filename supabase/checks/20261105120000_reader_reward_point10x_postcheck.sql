-- NOVELIGHT βPoint x10: full-row equality within ONE rollback-only transaction.
-- Every row must be exactly the old row with ONLY the approved unit field changed.
-- No read or write to any external provider. Writer RPC stays unchanged.
DO $nl10_post$ BEGIN
  IF EXISTS (
    SELECT 1 FROM nl10_before_ledger b
      FULL JOIN public.scout_point_ledger t ON t.id=b.id
    WHERE b.id IS NULL OR t.id IS NULL OR to_jsonb(t) IS DISTINCT FROM
      jsonb_set(b.full_row,'{point_value}',
        to_jsonb((b.old_point::bigint*10)::integer),true)
  ) THEN RAISE EXCEPTION 'NL10_POSTCHECK_LEDGER_ROW_DRIFT'; END IF;
  IF EXISTS (
    SELECT 1 FROM nl10_before_badges b
      FULL JOIN public.scout_badge_definitions t USING (badge_id)
    WHERE b.badge_id IS NULL OR t.badge_id IS NULL OR to_jsonb(t) IS DISTINCT FROM
      jsonb_set(
        jsonb_set(b.full_row,'{point_reward}',
          to_jsonb((b.old_reward::bigint*10)::integer),true),
        '{target_value}',to_jsonb(
          CASE WHEN b.metric_key='scout_point_earned_total'
            THEN b.old_target*10::bigint ELSE b.old_target END),true)
  ) THEN RAISE EXCEPTION 'NL10_POSTCHECK_BADGE_DEFINITION_ROW_DRIFT'; END IF;
  IF EXISTS (
    SELECT 1 FROM nl10_before_progress b
      FULL JOIN public.user_scout_badges t
        ON t.user_id=b.user_id AND t.badge_id=b.badge_id
    WHERE b.user_id IS NULL OR t.user_id IS NULL OR to_jsonb(t) IS DISTINCT FROM
      CASE WHEN b.badge_id IN ('reader_point_100','reader_point_500')
        THEN jsonb_set(b.full_row,'{progress_value}',
          to_jsonb(b.old_progress*10::bigint),true)
        ELSE b.full_row END
  ) THEN RAISE EXCEPTION 'NL10_POSTCHECK_BADGE_PROGRESS_ROW_DRIFT'; END IF;
  IF EXISTS (
    SELECT 1 FROM nl10_before_operator b
      FULL JOIN public.scout_point_operator_actions t USING(id)
    WHERE b.id IS NULL OR t.id IS NULL OR to_jsonb(t) IS DISTINCT FROM
      CASE WHEN b.old_amount IS NULL THEN b.full_row
        ELSE jsonb_set(b.full_row,'{amount}',
          to_jsonb((b.old_amount::bigint*10)::integer),true) END
  ) THEN RAISE EXCEPTION 'NL10_POSTCHECK_OPERATOR_ROW_DRIFT'; END IF;
  IF (SELECT count(*) FROM public.scout_point_ledger) <> 3581
    OR (SELECT coalesce(sum(point_value::bigint),0)
        FROM public.scout_point_ledger) <> 35810
    OR (SELECT count(DISTINCT event_key) FROM public.scout_point_ledger) <> 3581
    OR (SELECT count(DISTINCT user_id) FROM public.scout_point_ledger) <> 1605
    OR (SELECT coalesce(sum(point_reward::bigint),0)
        FROM public.scout_badge_definitions) <> 8350
    OR (SELECT coalesce(sum(progress_value),0) FROM public.user_scout_badges
        WHERE badge_id IN ('reader_point_100','reader_point_500')) <> 71620
  THEN RAISE EXCEPTION 'NL10_POSTCHECK_AGGREGATE_DRIFT'; END IF;
  IF (SELECT count(*) FROM public.scout_badge_definitions
       WHERE (badge_id='reader_point_100' AND target_value=1000)
          OR (badge_id='reader_point_500' AND target_value=5000)) <> 2
  THEN RAISE EXCEPTION 'NL10_POSTCHECK_BADGE_THRESHOLD_DRIFT'; END IF;
  IF md5(pg_get_functiondef('public.novelight_award_level_up_points()'::regprocedure))
        <> '830b9784d2e7d5bdd71054188aa06e91'
  THEN RAISE EXCEPTION 'NL10_POSTCHECK_WRITER_RPC_CHANGED'; END IF;
END $nl10_post$;

-- This proof intentionally cannot certify an atomic live cutover.
-- The trusted wrapper must execute an unconditional ROLLBACK afterward.
