-- NOVELIGHT βPoint x10: reviewed candidate precheck for rollback-only Staging.
-- ONLY the trusted-main compiler may use this file after OWNER authorization.
-- Pinned to a historical read-only Staging snapshot; drift must fail closed.
-- The calling wrapper begins the transaction and always rolls it back.
LOCK TABLE public.scout_point_ledger, public.scout_badge_definitions,
  public.user_scout_badges, public.scout_point_operator_actions IN ACCESS EXCLUSIVE MODE;

DO $nl10_guard$ BEGIN
  IF (SELECT count(*) FROM public.scout_point_ledger) <> 3581
    OR (SELECT count(DISTINCT user_id) FROM public.scout_point_ledger) <> 1605
    OR (SELECT coalesce(sum(point_value::bigint),0) FROM public.scout_point_ledger) <> 3581
    OR (SELECT count(DISTINCT event_key) FROM public.scout_point_ledger) <> 3581
  THEN RAISE EXCEPTION 'NL10_PRECHECK_STALE_LEDGER'; END IF;
  IF (SELECT count(*) FROM public.scout_badge_definitions) <> 182
    OR (SELECT coalesce(sum(point_reward::bigint),0) FROM public.scout_badge_definitions) <> 835
  THEN RAISE EXCEPTION 'NL10_PRECHECK_STALE_BADGE_DEFINITIONS'; END IF;
  IF (SELECT count(*) FROM public.user_scout_badges
      WHERE badge_id IN ('reader_point_100','reader_point_500')) <> 12870
    OR (SELECT coalesce(sum(progress_value),0) FROM public.user_scout_badges
      WHERE badge_id IN ('reader_point_100','reader_point_500')) <> 7162
  THEN RAISE EXCEPTION 'NL10_PRECHECK_STALE_POINT_PROGRESS'; END IF;
  IF (SELECT count(*) FROM public.scout_badge_definitions
      WHERE (badge_id='reader_point_100' AND metric_key='scout_point_earned_total' AND target_value=100)
         OR (badge_id='reader_point_500' AND metric_key='scout_point_earned_total' AND target_value=500)) <> 2
  THEN RAISE EXCEPTION 'NL10_PRECHECK_POINT_CONDITION_DRIFT'; END IF;
  IF (SELECT count(*) FROM public.scout_badge_definitions
      WHERE metric_key='scout_point_earned_total') <> 2
  THEN RAISE EXCEPTION 'NL10_PRECHECK_UNREVIEWED_POINT_METRIC'; END IF;
  IF EXISTS (SELECT 1 FROM public.scout_point_ledger
      WHERE point_value::bigint*10 NOT BETWEEN -1000000 AND 1000000)
    OR EXISTS (SELECT 1 FROM public.scout_badge_definitions
      WHERE point_reward::bigint*10 > 2147483647)
    OR EXISTS (SELECT 1 FROM public.scout_badge_definitions
      WHERE metric_key='scout_point_earned_total' AND target_value > 922337203685477580)
    OR EXISTS (SELECT 1 FROM public.user_scout_badges
      WHERE badge_id IN ('reader_point_100','reader_point_500')
      AND progress_value > 922337203685477580)
    OR EXISTS (SELECT 1 FROM public.scout_point_operator_actions
      WHERE amount IS NOT NULL AND amount::bigint*10 NOT BETWEEN -100000 AND 100000)
  THEN RAISE EXCEPTION 'NL10_PRECHECK_TENFOLD_RANGE_VIOLATION'; END IF;
  IF EXISTS (SELECT 1 FROM public.scout_point_ledger
      WHERE metadata ? 'point_unit_version' OR metadata ? 'unit_version')
  THEN RAISE EXCEPTION 'NL10_PRECHECK_UNIT_VERSION_ALREADY_PRESENT'; END IF;
  IF to_regclass('public.scout_point_unit_cutover_marker') IS NOT NULL
  THEN RAISE EXCEPTION 'NL10_PRECHECK_CUTOVER_MARKER_ALREADY_EXISTS'; END IF;
  IF md5(pg_get_functiondef('public.novelight_award_level_up_points()'::regprocedure))
       <> '830b9784d2e7d5bdd71054188aa06e91'
    OR md5(pg_get_functiondef('public.novelight_apply_scout_badge_evaluation(uuid,text,bigint,numeric,boolean,jsonb,boolean)'::regprocedure))
       <> 'e912c55468e49cdcf00be084f21d283b'
  THEN RAISE EXCEPTION 'NL10_PRECHECK_AWARD_FUNCTION_DRIFT'; END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE NOT t.tgisinternal AND t.tgrelid IN (
         'public.scout_point_ledger'::regclass,
         'public.scout_badge_definitions'::regclass,
         'public.user_scout_badges'::regclass,
         'public.scout_point_operator_actions'::regclass)) <> 3
  THEN RAISE EXCEPTION 'NL10_PRECHECK_UNREVIEWED_TRIGGER'; END IF;
  IF (SELECT count(*) FROM pg_trigger t
      WHERE NOT t.tgisinternal AND (
        (t.tgrelid='public.scout_point_ledger'::regclass AND
         ((t.tgname='scout_point_earning_control'
           AND pg_get_triggerdef(t.oid,true) LIKE '%BEFORE INSERT ON scout_point_ledger%')
          OR (t.tgname='scout_point_refresh_reader_badges'
           AND pg_get_triggerdef(t.oid,true) LIKE '%AFTER INSERT OR UPDATE OF status ON scout_point_ledger%')))
        OR (t.tgrelid='public.user_scout_badges'::regclass AND
          t.tgname='scout_title_default_unequipped' AND
          pg_get_triggerdef(t.oid,true) LIKE '%BEFORE INSERT ON user_scout_badges%')
      )) <> 3
  THEN RAISE EXCEPTION 'NL10_PRECHECK_TRIGGER_DEFINITION_DRIFT'; END IF;
END $nl10_guard$;

-- Temp snapshots are transaction-scoped and discarded by final ROLLBACK.
CREATE TEMP TABLE nl10_before_ledger ON COMMIT DROP AS
  SELECT id, point_value AS old_point, to_jsonb(x) AS full_row
  FROM public.scout_point_ledger x;
CREATE UNIQUE INDEX ON nl10_before_ledger(id);
CREATE TEMP TABLE nl10_before_badges ON COMMIT DROP AS
  SELECT badge_id, metric_key, point_reward AS old_reward,
    target_value AS old_target, to_jsonb(x) AS full_row
  FROM public.scout_badge_definitions x;
CREATE UNIQUE INDEX ON nl10_before_badges(badge_id);
CREATE TEMP TABLE nl10_before_progress ON COMMIT DROP AS
  SELECT user_id, badge_id, progress_value AS old_progress,
    to_jsonb(x) AS full_row FROM public.user_scout_badges x;
CREATE UNIQUE INDEX ON nl10_before_progress(user_id,badge_id);
CREATE TEMP TABLE nl10_before_operator ON COMMIT DROP AS
  SELECT id, amount AS old_amount, to_jsonb(x) AS full_row
  FROM public.scout_point_operator_actions x;
CREATE UNIQUE INDEX ON nl10_before_operator(id);
