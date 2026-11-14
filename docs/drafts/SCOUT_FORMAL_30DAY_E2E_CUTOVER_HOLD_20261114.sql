-- NOVELIGHT SCOUT formal 30-day internal E2E cutover wiring, Staging only.
-- No review activation or cutover: both DB gates remain CHECK(enabled=false).
-- No real-user rows, XP rows, existing seed rows, or release flags are changed.
-- Rollback in a separately authorized Staging migration:
--   restore the prior function definitions from migration 20261114062717 and
--   the original public beta/discovery functions; drop new private helper,
--   private E2E cutover table and the new evidence CHECK / issue_count column.
--   No destructive rollback is run automatically.


-- Staging/internal-E2E-only cutover remains physically disabled.
-- No accounts or XP rows are inserted or modified by this migration.
CREATE TABLE novelight_formal_private.scout_30d_e2e_cutover (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false CHECK (enabled = false),
  beta_reconciled_at timestamptz,
  discovery_reconciled_at timestamptz,
  source_finality_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE novelight_formal_private.scout_30d_e2e_cutover ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON novelight_formal_private.scout_30d_e2e_cutover
  FROM PUBLIC, anon, authenticated, service_role;

-- A client-supplied "seal" or booleans may never certify source completeness.
-- Existing candidate windows: zero. This enforces permanent HELD until
-- a distinct, verified release migration changes the constraint.
ALTER TABLE novelight_formal_private.scout_30d_window_evidence
  ADD CONSTRAINT scout_30d_unverified_window_held
  CHECK (source_evidence_verified = false AND late_issue = true);

-- Preserve repeat correction counts instead of silently losing repeated
-- UPDATE/DELETE issues through ON CONFLICT DO NOTHING.
ALTER TABLE novelight_formal_private.scout_30d_late_issue
  ADD COLUMN issue_count integer NOT NULL DEFAULT 1 CHECK (issue_count >= 1);

CREATE OR REPLACE FUNCTION public.novelight_cap_scout_xp_beta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cap integer;
  v_current bigint;
  v_remaining bigint;
begin
  -- Opt-in can only be staged for an auth-owned internal E2E reader.
  -- Both control tables explicitly CHECK(enabled=false), thus this never
  -- changes the currently active beta behavior.
  IF EXISTS (
    SELECT 1
    FROM novelight_formal_private.scout_30d_release_control g
    JOIN novelight_formal_private.scout_30d_e2e_cutover c
      ON c.enabled AND c.beta_reconciled_at IS NOT NULL
       AND c.discovery_reconciled_at IS NOT NULL
       AND c.source_finality_at IS NOT NULL
    JOIN auth.users u ON u.id=c.user_id
    WHERE g.singleton AND g.enabled AND g.beta_cutover_verified
      AND g.discovery_xp_verified AND g.source_finality_verified
      AND u.id=NEW.user_id
      AND u.raw_app_meta_data->>'internal_e2e'='true'
  ) THEN RETURN NEW; END IF;
  if new.xp_kind = 'light_seed_discovery' then
    return null;
  end if;

  if new.xp_value <= 0 then
    return new;
  end if;

  select t.cumulative_xp into v_cap
    from public.scout_level_thresholds t
   where t.level = 30;

  select coalesce(sum(x.xp_value), 0)::bigint into v_current
    from public.scout_xp_ledger x
   where x.user_id = new.user_id
     and x.xp_kind <> 'light_seed_discovery';

  v_remaining := v_cap::bigint - greatest(v_current, 0);
  if v_remaining <= 0 then
    return null;
  end if;

  new.xp_value := least(new.xp_value::bigint, v_remaining)::integer;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION novelight_formal_private.scout_30d_guard_xp_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid;
  v_ids uuid[];
  v_earliest timestamptz;
  v_xp_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_ids := ARRAY[NEW.user_id];
    v_earliest := NEW.occurred_at;
    v_xp_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_ids := ARRAY[OLD.user_id];
    v_earliest := OLD.occurred_at;
    v_xp_id := OLD.id;
  ELSE
    SELECT pg_catalog.array_agg(id ORDER BY id::text)
      INTO v_ids FROM (
        SELECT OLD.user_id AS id
        UNION
        SELECT NEW.user_id AS id
      ) x;
    v_earliest := least(OLD.occurred_at, NEW.occurred_at);
    v_xp_id := NEW.id;
  END IF;
  FOREACH v_user IN ARRAY v_ids LOOP
    -- Never mutate formal holds for orphaned or non-internal user IDs.
    IF NOT EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id=v_user
        AND u.raw_app_meta_data->>'internal_e2e'='true'
    ) THEN CONTINUE; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'novelight:scout-formal-xp-review:v1:' || v_user::text, 0
      )
    );
    -- Late/backdated/corrected XP invalidates unreviewed source proof.
    UPDATE novelight_formal_private.scout_30d_window_evidence e
      SET source_evidence_verified = false, late_issue = true
      WHERE e.user_id = v_user AND v_earliest < e.window_end_at
        AND e.source_evidence_verified = true;
    IF EXISTS (
      SELECT 1 FROM novelight_formal_private.scout_level_state s
      WHERE s.user_id = v_user
        AND s.last_review_end_at IS NOT NULL
        AND v_earliest < s.last_review_end_at
    ) OR EXISTS (
      SELECT 1 FROM novelight_formal_private.scout_30d_window_evidence e
      WHERE e.user_id = v_user
        AND v_earliest < e.window_end_at AND e.late_issue = true
    ) THEN
      INSERT INTO novelight_formal_private.scout_30d_late_issue
        (user_id,xp_id,event_kind,occurred_at)
      VALUES (v_user,v_xp_id,TG_OP,v_earliest)
      ON CONFLICT (user_id,xp_id,event_kind) DO UPDATE
      SET detected_at=EXCLUDED.detected_at,
          issue_count=novelight_formal_private.scout_30d_late_issue.issue_count+1;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION novelight_formal_private.scout_30d_discovery_e2e_from_rank(p_rank_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rank_event public.novel_rank_events%rowtype;
  v_seed public.seed_discovery_state%rowtype;
  v_base_xp integer;
  v_multiplier numeric;
  v_cumulative_xp integer;
  v_delta_xp integer;
  v_event_id uuid;
  v_reader uuid;
begin
  select * into v_rank_event
    from public.novel_rank_events
   where id = p_rank_event_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM novelight_formal_private.scout_30d_release_control g
    WHERE g.singleton AND g.enabled AND g.source_finality_verified
      AND g.beta_cutover_verified AND g.discovery_xp_verified
  ) THEN RETURN; END IF;

  -- Acquire per-reader locks in a stable order before seed row FOR UPDATE.
  FOR v_reader IN
    SELECT DISTINCT s.reader_id FROM public.seed_discovery_state s
    JOIN auth.users u ON u.id=s.reader_id
      AND u.raw_app_meta_data->>'internal_e2e'='true'
    JOIN novelight_formal_private.scout_30d_e2e_cutover c
      ON c.user_id=s.reader_id AND c.enabled
      AND c.beta_reconciled_at IS NOT NULL
      AND c.discovery_reconciled_at IS NOT NULL
      AND c.source_finality_at IS NOT NULL
    WHERE s.novel_id_snapshot=v_rank_event.novel_id_snapshot
    ORDER BY s.reader_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'novelight:scout-formal-xp-review:v1:' || v_reader::text,0
      )
    );
  END LOOP;
  for v_seed in
    select s.*
      from public.seed_discovery_state s
      JOIN auth.users u ON u.id=s.reader_id
        AND u.raw_app_meta_data->>'internal_e2e'='true'
      JOIN novelight_formal_private.scout_30d_e2e_cutover c
        ON c.user_id=s.reader_id AND c.enabled
        AND c.beta_reconciled_at IS NOT NULL
        AND c.discovery_reconciled_at IS NOT NULL
        AND c.source_finality_at IS NOT NULL
     where s.novel_id_snapshot = v_rank_event.novel_id_snapshot
       and v_rank_event.occurred_at >= s.window_expires_at - interval '180 days'
       and v_rank_event.occurred_at <= s.window_expires_at
       and v_rank_event.to_rank > s.highest_rank_seen
     order by s.seed_id
     for update
  loop
    v_base_xp := case
      when v_seed.rank_at_seed = 5 and v_rank_event.to_rank = 6 then 80
      when v_rank_event.to_rank - v_seed.rank_at_seed >= 5 then 1000
      when v_rank_event.to_rank - v_seed.rank_at_seed = 4 then 600
      when v_rank_event.to_rank - v_seed.rank_at_seed = 3 then 300
      when v_rank_event.to_rank - v_seed.rank_at_seed = 2 then 150
      else 0
    end;
    v_multiplier := case v_seed.seed_type
      when 'GOLD' then 2.0
      when 'SILVER' then 1.5
      else 1.0
    end;
    v_cumulative_xp := (v_base_xp * v_multiplier)::integer;
    v_delta_xp := greatest(v_cumulative_xp - v_seed.cumulative_discovery_xp, 0);

    update public.seed_discovery_state
       set highest_rank_seen = greatest(highest_rank_seen, v_rank_event.to_rank),
           best_rank_delta = greatest(best_rank_delta, v_rank_event.to_rank - rank_at_seed),
           cumulative_discovery_xp = greatest(cumulative_discovery_xp, v_cumulative_xp),
           updated_at = now()
     where seed_id = v_seed.seed_id;

    if v_delta_xp > 0 then
      insert into public.scout_event_ledger (
        user_id, event_type, event_key, novel_id_snapshot, seed_id, occurred_at, metadata
      ) values (
        v_seed.reader_id,
        'light_seed_discovery',
        'light_seed_discovery:' || v_seed.seed_id::text || ':' || v_cumulative_xp::text,
        v_seed.novel_id_snapshot,
        v_seed.seed_id,
        v_rank_event.occurred_at,
        jsonb_build_object(
          'rank_event_id', v_rank_event.id,
          'seeded_at', v_seed.window_expires_at - interval '180 days',
          'window_expires_at', v_seed.window_expires_at,
          'seed_type', v_seed.seed_type,
          'rank_at_seed', v_seed.rank_at_seed,
          'reached_rank', v_rank_event.to_rank,
          'base_xp', v_base_xp,
          'multiplier', v_multiplier,
          'cumulative_xp', v_cumulative_xp,
          'delta_xp', v_delta_xp,
          'rule_version', 'chapter38-discovery-v1'
        )
      )
      on conflict (event_key) do nothing
      returning id into v_event_id;

      if v_event_id is not null then
        insert into public.scout_xp_ledger (
          user_id, source_event_id, xp_kind, xp_value, rule_version, occurred_at
        ) values (
          v_seed.reader_id, v_event_id, 'light_seed_discovery', v_delta_xp,
          'chapter38-discovery-v1', v_rank_event.occurred_at
        )
        on conflict (user_id, source_event_id, xp_kind) do nothing;
      end if;
    end if;
  end loop;
end
$function$;

REVOKE ALL ON FUNCTION novelight_formal_private.scout_30d_discovery_e2e_from_rank(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.novelight_process_seed_discovery_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  IF EXISTS (
    SELECT 1 FROM novelight_formal_private.scout_30d_release_control g
    WHERE g.singleton AND g.enabled AND g.beta_cutover_verified
      AND g.discovery_xp_verified AND g.source_finality_verified
  ) THEN
    PERFORM novelight_formal_private.scout_30d_discovery_e2e_from_rank(new.id);
  END IF;
  perform public.novelight_process_seed_discovery(new.id);
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION novelight_formal_private.review_scout_30_days_sealed(p_user_id uuid, p_as_of timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_state novelight_formal_private.scout_level_state%rowtype;
  v_end timestamptz;
  v_start timestamptz;
  v_xp bigint;
  v_negative boolean;
  v_next smallint;
BEGIN
  -- Even if the release constraints are later lifted, only verified
  -- internal E2E data may be reviewed by this Staging-specific endpoint.
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id=p_user_id
      AND u.raw_app_meta_data->>'internal_e2e'='true'
  ) THEN RETURN pg_catalog.jsonb_build_object('status','held'); END IF;
  IF p_user_id IS NULL OR p_as_of IS NULL
     OR p_as_of > pg_catalog.clock_timestamp() THEN
    RETURN pg_catalog.jsonb_build_object('status','held');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'novelight:scout-formal-xp-review:v1:' || p_user_id::text, 0
    )
  );
  SELECT * INTO v_state
    FROM novelight_formal_private.scout_level_state
    WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status','held'); END IF;
  v_start := coalesce(v_state.last_review_end_at,v_state.review_anchor_at);
  v_end := v_start + interval '30 days';
  IF p_as_of < v_end THEN
    RETURN pg_catalog.jsonb_build_object('status','not_due');
  END IF;
  IF EXISTS (
    SELECT 1 FROM novelight_formal_private.scout_review_claim
      WHERE user_id=p_user_id AND window_end_at=v_end
  ) THEN RETURN pg_catalog.jsonb_build_object('status','already_reviewed'); END IF;

  -- Explicitly stay held while beta cap/discovery is not cut over.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='public.scout_xp_ledger'::regclass
      AND t.tgname='scout_xp_beta_level_cap'
      AND t.tgenabled IN ('O','A')
  ) AND NOT EXISTS (
    SELECT 1
    FROM novelight_formal_private.scout_30d_e2e_cutover c
    WHERE c.user_id=p_user_id AND c.enabled
      AND c.beta_reconciled_at IS NOT NULL
      AND c.discovery_reconciled_at IS NOT NULL
      AND c.source_finality_at IS NOT NULL
  ) THEN RETURN pg_catalog.jsonb_build_object('status','beta_cutover_pending'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM novelight_formal_private.scout_30d_release_control g
    WHERE g.singleton AND g.enabled
      AND g.source_finality_verified AND g.beta_cutover_verified
      AND g.discovery_xp_verified
  ) THEN RETURN pg_catalog.jsonb_build_object('status','held'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM novelight_formal_private.scout_30d_window_evidence e
    WHERE e.user_id = p_user_id AND e.window_end_at = v_end
      AND e.sealed_at IS NOT NULL
      AND e.source_watermark_at >= v_end
      AND e.source_evidence_verified AND NOT e.late_issue
  ) THEN RETURN pg_catalog.jsonb_build_object('status','window_unsealed'); END IF;

  IF EXISTS (
    SELECT 1 FROM novelight_formal_private.scout_30d_late_issue i
    WHERE i.user_id=p_user_id AND i.occurred_at < v_end
  ) THEN RETURN pg_catalog.jsonb_build_object('status','late_xp_pending'); END IF;
  SELECT coalesce(pg_catalog.sum(greatest(0,x.xp_value)),0),
         coalesce(pg_catalog.bool_or(x.xp_value < 0),false)
    INTO v_xp,v_negative
    FROM public.scout_xp_ledger x
   WHERE x.user_id=p_user_id
     AND x.occurred_at>=v_start AND x.occurred_at<v_end;
  IF v_negative THEN
    RETURN pg_catalog.jsonb_build_object('status','adjustment_policy_pending');
  END IF;
  IF v_xp > 2147483647 THEN
    RETURN pg_catalog.jsonb_build_object('status','held');
  END IF;
  v_next := CASE WHEN v_xp >= 200 THEN v_state.current_level
    ELSE greatest(
      CASE WHEN v_state.highest_level>=70 THEN 50 ELSE 1 END,
      v_state.current_level-1
    ) END;
  INSERT INTO novelight_formal_private.scout_review_claim
    (user_id,window_end_at,awarded_xp,before_level,after_level)
    VALUES(p_user_id,v_end,v_xp::integer,v_state.current_level,v_next);
  UPDATE novelight_formal_private.scout_level_state
     SET current_level=v_next,
         level_progress_xp=CASE WHEN v_next<v_state.current_level
                               THEN 0 ELSE level_progress_xp END,
         last_review_end_at=v_end,revision=revision+1
   WHERE user_id=p_user_id;
  RETURN pg_catalog.jsonb_build_object(
    'status','reviewed','level',v_next,'earned_xp',v_xp,
    'demoted',v_next<v_state.current_level,'window_end',v_end
  );
END $function$;

-- Ensure the unsafe legacy review RPC cannot be called by service_role.
REVOKE EXECUTE ON FUNCTION
  novelight_formal_private.review_scout_30_days(uuid,timestamptz)
  FROM service_role;
