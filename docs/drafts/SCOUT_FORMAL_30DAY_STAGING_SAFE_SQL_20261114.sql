-- NOVELIGHT 30-day Scout Staging SQL IMPLEMENTATION CANDIDATE.
-- NOT A MIGRATION. DO NOT APPLY: Staging project identity and branch privileges
-- are not yet verifiable with the authorized Supabase connector.
-- Formal review remains HARD DISABLED: no user demotions, XP mutations or cutover.
-- Separate verification and approval required before any SQL execution.
--
-- Rollback if separately authorized in a controlled Staging transaction:
-- DROP TRIGGER IF EXISTS aa_scout_30d_xp_guard ON public.scout_xp_ledger;
-- DROP FUNCTION IF EXISTS novelight_formal_private.scout_30d_guard_xp_mutation();
-- DROP FUNCTION IF EXISTS novelight_formal_private.review_scout_30_days_sealed(uuid,timestamptz);
-- DROP FUNCTION IF EXISTS novelight_formal_private.list_due_scout_30_day_reviews(timestamptz,integer);
-- DROP TABLE IF EXISTS novelight_formal_private.scout_30d_late_issue;
-- DROP TABLE IF EXISTS novelight_formal_private.scout_30d_window_evidence;
-- DROP TABLE IF EXISTS novelight_formal_private.scout_30d_release_control;
-- No rollback is executed as part of this candidate.

CREATE TABLE novelight_formal_private.scout_30d_release_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false CHECK (enabled = false),
  source_finality_verified boolean NOT NULL DEFAULT false,
  beta_cutover_verified boolean NOT NULL DEFAULT false,
  discovery_xp_verified boolean NOT NULL DEFAULT false
);
INSERT INTO novelight_formal_private.scout_30d_release_control(singleton)
VALUES (true);
ALTER TABLE novelight_formal_private.scout_30d_release_control
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON novelight_formal_private.scout_30d_release_control
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE novelight_formal_private.scout_30d_window_evidence (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_end_at timestamptz NOT NULL,
  sealed_at timestamptz,
  source_watermark_at timestamptz,
  source_evidence_verified boolean NOT NULL DEFAULT false,
  late_issue boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, window_end_at),
  CHECK (sealed_at IS NULL OR sealed_at >= window_end_at)
);
ALTER TABLE novelight_formal_private.scout_30d_window_evidence
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON novelight_formal_private.scout_30d_window_evidence
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE novelight_formal_private.scout_30d_late_issue (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  xp_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('INSERT','UPDATE','DELETE')),
  occurred_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (user_id, xp_id, event_kind)
);
ALTER TABLE novelight_formal_private.scout_30d_late_issue
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON novelight_formal_private.scout_30d_late_issue
  FROM PUBLIC, anon, authenticated, service_role;

-- Shared reader-key lock quotation in JS uses the identical namespace.
-- BEFORE INSERT/UPDATE/DELETE protects direct XP ledger mutations;
-- parent event ingress locks and ingestion finality still require audit.
CREATE FUNCTION novelight_formal_private.scout_30d_guard_xp_mutation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION
  novelight_formal_private.scout_30d_guard_xp_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
-- Name sorts before scout_xp_beta_level_cap. Beta cap remains untouched.
-- DO NOT INSTALL until parent-event lock order has been proved in Staging.
CREATE TRIGGER aa_scout_30d_xp_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.scout_xp_ledger
  FOR EACH ROW EXECUTE FUNCTION
    novelight_formal_private.scout_30d_guard_xp_mutation();

-- Private least-privilege due-user discovery: never GRANT table SELECT
-- to service_role. The release_control CHECK keeps it empty until re-approved.
CREATE FUNCTION novelight_formal_private.list_due_scout_30_day_reviews(
  p_as_of timestamptz, p_limit integer
) RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_as_of IS NULL OR p_as_of > pg_catalog.clock_timestamp()
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 25 THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM novelight_formal_private.scout_30d_release_control g
    WHERE g.singleton AND g.enabled
      AND g.source_finality_verified
      AND g.beta_cutover_verified
      AND g.discovery_xp_verified
  ) THEN RETURN; END IF;
  RETURN QUERY SELECT s.user_id
    FROM novelight_formal_private.scout_level_state s
   WHERE coalesce(s.last_review_end_at,s.review_anchor_at)
         + interval '30 days' <= p_as_of
   ORDER BY coalesce(s.last_review_end_at,s.review_anchor_at),
            s.user_id
   LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION
  novelight_formal_private.list_due_scout_30_day_reviews(timestamptz,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  novelight_formal_private.list_due_scout_30_day_reviews(timestamptz,integer)
  TO service_role;

-- New sealed reviewer: never delegates to unsafe review_scout_30_days.
-- Release state CHECK(enabled=false) makes demotion unreachable until a
-- separate approved release migration and independent source-finality proof.
CREATE FUNCTION novelight_formal_private.review_scout_30_days_sealed(
  p_user_id uuid, p_as_of timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_state novelight_formal_private.scout_level_state%rowtype;
  v_end timestamptz;
  v_start timestamptz;
  v_xp bigint;
  v_negative boolean;
  v_next smallint;
BEGIN
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
END $$;
REVOKE ALL ON FUNCTION
  novelight_formal_private.review_scout_30_days_sealed(uuid,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  novelight_formal_private.review_scout_30_days_sealed(uuid,timestamptz)
  TO service_role;
-- Existing beta cap, discovery awarding, and legacy RPC are NOT replaced.
-- Actual source-finality verifier and beta-to-formal cutover remain unapproved.
