-- NOVELIGHT β Scout Point x10, existing Supabase / REVIEW ONLY.
-- INTENTIONALLY outside supabase/migrations/ and active GitHub workflows.
-- No new CONTROL. No activation, no interchange, no AI Point spending.
-- Source: PR #2763's five unit updates; 20260928061000 live beta level RPC.
-- All approval GUCs MUST come from a newly reviewed future trusted adapter.
-- GUCs are not proof of GitHub identity or DB endpoint. Do not run on Production.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
-- PostgreSQL 17+ enforces a whole-transaction deadline, not just each statement.
SET LOCAL transaction_timeout = '90s';
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '120s';

DO $scope$
BEGIN
  IF current_setting('novelight.point10x_scope', true)
       IS DISTINCT FROM 'reader-reward-beta-point-tenfold-existing-db-staging-v1'
    OR current_setting('novelight.point10x_mode', true)
       IS DISTINCT FROM 'staging-beta-atomic-single-use'
    OR current_setting('novelight.point10x_staging_ref', true)
       IS DISTINCT FROM 'wmlzjgvxgoyrovdhbqbg'
    OR current_setting('novelight.point10x_owner_id', true)
       IS DISTINCT FROM '317436651'
    OR current_setting('novelight.point10x_run_count', true)
       IS DISTINCT FROM '1'
    OR coalesce(current_setting('novelight.point10x_approved_main', true),'')
       !~ '^[0-9a-f]{40}$'
    OR coalesce(current_setting('novelight.point10x_approved_comment', true),'')
       !~ '^[1-9][0-9]{0,17}$'
  THEN RAISE EXCEPTION 'NL10_NEW_STAGING_ONLY_SCOPE_REQUIRED'; END IF;
END;
$scope$;

-- Lock Point entry points and related ledgers AFTER verified external drain.
LOCK TABLE public.scout_event_ledger, public.scout_xp_ledger,
  public.scout_point_ledger, public.scout_badge_definitions,
  public.user_scout_badges, public.scout_point_operator_actions
IN ACCESS EXCLUSIVE MODE;

DO $precheck$
BEGIN
  IF to_regnamespace('point10x_beta') IS NOT NULL
  THEN RAISE EXCEPTION 'NL10_MARKER_ALREADY_EXISTS'; END IF;
  -- Identical hashes read from Production catalog 2026-11-06, READ-ONLY.
  IF md5(pg_get_functiondef('public.novelight_award_level_up_points()'::regprocedure))
        <> '830b9784d2e7d5bdd71054188aa06e91'
    OR md5(pg_get_functiondef(
      'public.novelight_apply_scout_badge_evaluation(uuid,text,bigint,numeric,boolean,jsonb,boolean)'::regprocedure))
        <> 'e912c55468e49cdcf00be084f21d283b'
    OR md5(pg_get_functiondef('public.novelight_award_discovery_points()'::regprocedure))
        <> 'f016fc2098eb7e2dcfc50898fd5812a0'
  THEN RAISE EXCEPTION 'NL10_RPC_DRIFT'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c
    WHERE c.oid IN ('public.scout_point_ledger'::regclass,
      'public.scout_badge_definitions'::regclass, 'public.user_scout_badges'::regclass,
      'public.scout_point_operator_actions'::regclass, 'public.scout_xp_ledger'::regclass)
      AND NOT c.relrowsecurity)
  THEN RAISE EXCEPTION 'NL10_RLS_DRIFT'; END IF;
  IF (SELECT count(*) FROM public.scout_badge_definitions
      WHERE metric_key = 'scout_point_earned_total') <> 2
    OR (SELECT count(*) FROM public.scout_badge_definitions
      WHERE (badge_id='reader_point_100' AND target_value=100
        AND metric_key='scout_point_earned_total')
        OR (badge_id='reader_point_500' AND target_value=500
        AND metric_key='scout_point_earned_total')) <> 2
  THEN RAISE EXCEPTION 'NL10_POINT_BADGE_DRIFT'; END IF;
  IF EXISTS (SELECT 1 FROM public.scout_point_ledger
      WHERE point_value::bigint NOT BETWEEN -100000 AND 100000
        OR metadata ? 'point_unit_version' OR metadata ? 'unit_version')
    OR EXISTS (SELECT 1 FROM public.scout_badge_definitions
      WHERE point_reward::bigint NOT BETWEEN 0 AND 214748364
        OR (metric_key='scout_point_earned_total'
          AND target_value NOT BETWEEN 0 AND 922337203685477580))
    OR EXISTS (SELECT 1 FROM public.user_scout_badges
      WHERE badge_id IN ('reader_point_100','reader_point_500')
        AND progress_value NOT BETWEEN 0 AND 922337203685477580)
    OR EXISTS (SELECT 1 FROM public.scout_point_operator_actions
      WHERE amount IS NOT NULL AND amount::bigint NOT BETWEEN -10000 AND 10000)
  THEN RAISE EXCEPTION 'NL10_RANGE_OR_REPLAY'; END IF;
END;
$precheck$;

-- Full-row before-snapshots; progress is limited to Point badges, without fixed Staging row counts.
CREATE TEMP TABLE nl10_before_ledger ON COMMIT DROP AS
  SELECT id, point_value old_value, to_jsonb(t) old_row
  FROM public.scout_point_ledger t;
CREATE TEMP TABLE nl10_before_badges ON COMMIT DROP AS
  SELECT badge_id, point_reward old_reward, target_value old_target,
    metric_key old_metric, to_jsonb(t) old_row FROM public.scout_badge_definitions t;
CREATE TEMP TABLE nl10_before_progress ON COMMIT DROP AS
  SELECT user_id, badge_id, progress_value old_value, to_jsonb(t) old_row
  FROM public.user_scout_badges t
  WHERE badge_id IN ('reader_point_100','reader_point_500');
CREATE TEMP TABLE nl10_before_operator ON COMMIT DROP AS
  SELECT id, amount old_value, to_jsonb(t) old_row
  FROM public.scout_point_operator_actions t;
CREATE TEMP TABLE nl10_before_rpc ON COMMIT DROP AS
  SELECT proowner, proacl, prosecdef, proconfig FROM pg_proc
  WHERE oid='public.novelight_award_level_up_points()'::regprocedure;

-- PR #2763, same five field conversions. XP, statuses, IDs and keys unchanged.
UPDATE public.scout_point_ledger SET point_value=(point_value::bigint*10)::integer;
UPDATE public.scout_badge_definitions SET point_reward=(point_reward::bigint*10)::integer;
UPDATE public.scout_badge_definitions SET target_value=target_value*10::bigint
  WHERE metric_key='scout_point_earned_total';
UPDATE public.user_scout_badges SET progress_value=progress_value*10::bigint
  WHERE badge_id IN ('reader_point_100','reader_point_500');
UPDATE public.scout_point_operator_actions SET amount=(amount::bigint*10)::integer
  WHERE amount IS NOT NULL;

-- Current 20260928 beta RPC, one numeric change: 5 Point -> 50 Point.
-- Keep hidden-discovery exclusions, XP logic, definer, owner and ACL intact.
create or replace function public.novelight_award_level_up_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_total bigint;
  v_old_total bigint;
  v_old_level smallint;
  v_new_level smallint;
  v_level integer;
begin
  if new.xp_value <= 0 or new.xp_kind = 'light_seed_discovery' then
    return new;
  end if;

  select coalesce(sum(x.xp_value), 0)::bigint into v_new_total
    from public.scout_xp_ledger x
   where x.user_id = new.user_id
     and x.xp_kind <> 'light_seed_discovery';

  v_old_total := greatest(v_new_total - new.xp_value, 0);
  v_old_level := public.novelight_scout_level_for_xp(v_old_total);
  v_new_level := public.novelight_scout_level_for_xp(v_new_total);

  if v_new_level <= v_old_level then
    return new;
  end if;

  for v_level in (v_old_level + 1)..v_new_level loop
    insert into public.scout_point_ledger (
      user_id, source_xp_id, point_kind, point_value, status,
      event_key, occurred_at, metadata
    ) values (
      new.user_id,
      new.id,
      'level_up',
      50,
      'confirmed',
      'level_up:' || new.user_id::text || ':' || v_level::text,
      new.occurred_at,
      pg_catalog.jsonb_build_object(
        'level', v_level,
        'rule_version', 'chapter49-beta-rank-private-point10x-v1'
      )
    )
    on conflict (event_key) do nothing;
  end loop;

  return new;
end
$$;
DO $postcheck$
BEGIN
  IF EXISTS (SELECT 1 FROM nl10_before_ledger b
    FULL JOIN public.scout_point_ledger t ON t.id=b.id
    WHERE b.id IS NULL OR t.id IS NULL OR to_jsonb(t) IS DISTINCT FROM
      jsonb_set(b.old_row,'{point_value}',to_jsonb((b.old_value::bigint*10)::integer),true))
  THEN RAISE EXCEPTION 'NL10_LEDGER_MISMATCH'; END IF;
  IF EXISTS (SELECT 1 FROM nl10_before_badges b
    FULL JOIN public.scout_badge_definitions t USING (badge_id)
    WHERE b.badge_id IS NULL OR t.badge_id IS NULL OR to_jsonb(t) IS DISTINCT FROM
      jsonb_set(jsonb_set(b.old_row,'{point_reward}',
        to_jsonb((b.old_reward::bigint*10)::integer),true),'{target_value}',
        to_jsonb(CASE WHEN b.old_metric='scout_point_earned_total'
          THEN b.old_target*10::bigint ELSE b.old_target END),true))
  THEN RAISE EXCEPTION 'NL10_BADGE_MISMATCH'; END IF;
  IF EXISTS (SELECT 1 FROM nl10_before_progress b
    FULL JOIN (SELECT * FROM public.user_scout_badges
      WHERE badge_id IN ('reader_point_100','reader_point_500')) t
      USING (user_id,badge_id)
    WHERE b.user_id IS NULL OR t.user_id IS NULL OR to_jsonb(t) IS DISTINCT FROM
      jsonb_set(b.old_row,'{progress_value}',to_jsonb(b.old_value*10::bigint),true))
  THEN RAISE EXCEPTION 'NL10_PROGRESS_MISMATCH'; END IF;
  IF EXISTS (SELECT 1 FROM nl10_before_operator b
    FULL JOIN public.scout_point_operator_actions t USING (id)
    WHERE b.id IS NULL OR t.id IS NULL OR to_jsonb(t) IS DISTINCT FROM
      CASE WHEN b.old_value IS NULL THEN b.old_row ELSE
        jsonb_set(b.old_row,'{amount}',to_jsonb((b.old_value::bigint*10)::integer),true) END)
  THEN RAISE EXCEPTION 'NL10_OPERATOR_MISMATCH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM nl10_before_rpc b
    JOIN pg_proc p ON p.oid='public.novelight_award_level_up_points()'::regprocedure
    WHERE p.proowner=b.proowner AND p.proacl IS NOT DISTINCT FROM b.proacl
      AND p.prosecdef=b.prosecdef AND p.proconfig IS NOT DISTINCT FROM b.proconfig)
    OR md5(pg_get_functiondef('public.novelight_award_level_up_points()'::regprocedure))
       = '830b9784d2e7d5bdd71054188aa06e91'
  THEN RAISE EXCEPTION 'NL10_RPC_OR_PRIVILEGES_MISMATCH'; END IF;
END;
$postcheck$;

-- A private marker is committed WITH the five updates and updated RPC.
-- This is not independent CONTROL or a durable external approval-spent log.
CREATE SCHEMA point10x_beta;
REVOKE ALL ON SCHEMA point10x_beta FROM PUBLIC;
CREATE TABLE point10x_beta.unit_cutover (
  singleton smallint PRIMARY KEY CHECK (singleton = 1),
  approved_main_sha text NOT NULL CHECK (approved_main_sha ~ '^[0-9a-f]{40}$'),
  approved_comment_id bigint NOT NULL CHECK (approved_comment_id > 0),
  source_rpc_md5 text NOT NULL CHECK (source_rpc_md5 = '830b9784d2e7d5bdd71054188aa06e91'),
  converted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE point10x_beta.unit_cutover ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE point10x_beta.unit_cutover FROM PUBLIC, anon, authenticated;
INSERT INTO point10x_beta.unit_cutover
  (singleton,approved_main_sha,approved_comment_id,source_rpc_md5)
VALUES (1,current_setting('novelight.point10x_approved_main',true),
  current_setting('novelight.point10x_approved_comment',true)::bigint,
  '830b9784d2e7d5bdd71054188aa06e91');

-- COMMIT ACK unknown: no retry. Read primary marker and independent evidence.
COMMIT;
