-- NOVELIGHT SCOUT: deterministic single-window level restoration (Staging only).
-- This migration does NOT authorize formal review or beta cutover.
-- Both DB enabled flags remain constrained to false; JS release gate stays false.
-- This is a future restoration path only. Existing XP, users, claims and levels
-- are not rewritten, and no points, awards or badges are ever granted here.
-- Immutable past database rows CANNOT prove no future upstream retries arrive:
-- trusted producer settlement proof remains absent and reviews MUST remain HELD.
--
-- Separately approved rollback: DROP CONSTRAINT TRIGGER
--   zzzz_scout_30d_deferred_restore ON public.scout_xp_ledger;
-- DROP FUNCTION novelight_formal_private.scout_30d_deferred_restore();
-- DROP FUNCTION novelight_formal_private.scout_30d_try_restore_e2e(uuid);
-- DROP TABLE novelight_formal_private.scout_30d_restoration_claim;
-- No rollback or activation is performed by this migration.

CREATE TABLE novelight_formal_private.scout_30d_restoration_claim (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_end_at timestamptz NOT NULL,
  xp_at_review integer NOT NULL CHECK (xp_at_review < 200),
  corrected_window_xp bigint NOT NULL CHECK (corrected_window_xp >= 200),
  restored_from_level smallint NOT NULL,
  restored_to_level smallint NOT NULL,
  restored_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (user_id,window_end_at),
  CHECK (restored_to_level > restored_from_level)
);
ALTER TABLE novelight_formal_private.scout_30d_restoration_claim
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON novelight_formal_private.scout_30d_restoration_claim
  FROM PUBLIC,anon,authenticated,service_role;

-- Trigger-only function. It is deliberately in a private schema, and
-- caller roles (including service_role) have no direct EXECUTE permission.
-- The existing claim provides the exact level before/after a demotion.
-- We restore the same pre-demotion level; NEVER recompute levels for later
-- windows or touch XP, progress, highest level, points, badges or rewards.
CREATE FUNCTION novelight_formal_private.scout_30d_try_restore_e2e(
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_end timestamptz;
  v_window_count bigint;
  v_state novelight_formal_private.scout_level_state%rowtype;
  v_review novelight_formal_private.scout_review_claim%rowtype;
  v_xp bigint;
  v_negative boolean;
  v_changed integer;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  -- Existing CHECK (enabled=false) on BOTH tables guarantees this branch
  -- cannot execute today, including when called by a privileged role.
  IF NOT EXISTS (
    SELECT 1
    FROM novelight_formal_private.scout_30d_release_control g
    JOIN novelight_formal_private.scout_30d_e2e_cutover c
      ON c.enabled AND c.beta_reconciled_at IS NOT NULL
       AND c.discovery_reconciled_at IS NOT NULL
       AND c.source_finality_at IS NOT NULL
    JOIN auth.users u ON u.id=c.user_id
    WHERE g.singleton AND g.enabled AND g.source_finality_verified
      AND g.beta_cutover_verified AND g.discovery_xp_verified
      AND c.user_id=p_user_id
      AND u.raw_app_meta_data->>'internal_e2e'='true'
  ) THEN RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'novelight:scout-formal-xp-review:v1:' || p_user_id::text,0
    )
  );
  -- A second correction after an earlier restoration, or pending events
  -- affecting several reviewed windows, must go to human review.
  SELECT count(DISTINCT h.window_end_at),min(h.window_end_at)
    INTO v_window_count,v_end
    FROM novelight_formal_private.scout_30d_compensation_hold h
    LEFT JOIN novelight_formal_private.scout_30d_restoration_claim a
      ON a.user_id=h.user_id AND a.window_end_at=h.window_end_at
    WHERE h.user_id=p_user_id
      AND h.status='pending'
      AND (a.user_id IS NULL OR h.last_seen_at>a.restored_at);
  IF v_window_count <> 1 OR v_end IS NULL THEN RETURN; END IF;

  SELECT * INTO v_review
    FROM novelight_formal_private.scout_review_claim r
   WHERE r.user_id=p_user_id AND r.window_end_at=v_end FOR UPDATE;
  IF NOT FOUND OR v_review.after_level >= v_review.before_level
      OR v_review.awarded_xp >= 200 THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM novelight_formal_private.scout_review_claim r
    WHERE r.user_id=p_user_id AND r.window_end_at>v_end
  ) OR EXISTS (
    SELECT 1 FROM novelight_formal_private.scout_30d_restoration_claim a
    WHERE a.user_id=p_user_id AND a.window_end_at=v_end
  ) THEN RETURN; END IF;

  SELECT * INTO v_state
    FROM novelight_formal_private.scout_level_state s
    WHERE s.user_id=p_user_id FOR UPDATE;
  IF NOT FOUND
    OR v_state.last_review_end_at IS DISTINCT FROM v_end
    OR v_state.current_level <> v_review.after_level
    OR v_state.highest_level < v_review.before_level THEN RETURN; END IF;
  -- Recompute from the transaction's committed plus same-transaction XP
  -- snapshot. Signed adjustments or other ambiguity forbid auto restoration.
  SELECT coalesce(sum(x.xp_value),0),
         coalesce(bool_or(x.xp_value<0),false)
    INTO v_xp,v_negative
    FROM public.scout_xp_ledger x
   WHERE x.user_id=p_user_id
     AND x.occurred_at >= v_end-interval '30 days'
     AND x.occurred_at < v_end;
  IF v_negative OR v_xp<200 THEN RETURN; END IF;
  -- Only the level can change. No XP or awards re-issued.
  UPDATE novelight_formal_private.scout_level_state s
     SET current_level=v_review.before_level,
         revision=s.revision+1
   WHERE s.user_id=p_user_id
     AND s.current_level=v_review.after_level
     AND s.last_review_end_at=v_end
     AND s.highest_level>=v_review.before_level;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed<>1 THEN
    RAISE EXCEPTION 'SCOUT restoration state changed concurrently';
  END IF;
  -- A unique claim makes restoration exactly-once. Any failure rolls
  -- back the level update in the SAME transaction.
  INSERT INTO novelight_formal_private.scout_30d_restoration_claim(
    user_id,window_end_at,xp_at_review,corrected_window_xp,
    restored_from_level,restored_to_level
  ) VALUES (
    p_user_id,v_end,v_review.awarded_xp,v_xp,
    v_review.after_level,v_review.before_level
  );
END
$$;
REVOKE ALL ON FUNCTION
  novelight_formal_private.scout_30d_try_restore_e2e(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- A deferred trigger examines the FINAL state of a multi-row transaction,
-- not a temporary intermediate XP sum. Only positive, monotone XP changes
-- can restore automatically. Negative/deletion/user-transfer events remain
-- in the existing pending-compensation queue for human review.
CREATE FUNCTION novelight_formal_private.scout_30d_deferred_restore()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.xp_value>0 THEN
      PERFORM novelight_formal_private.scout_30d_try_restore_e2e(NEW.user_id);
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.user_id=NEW.user_id
       AND OLD.source_event_id=NEW.source_event_id
       AND OLD.xp_kind=NEW.xp_kind
       AND OLD.occurred_at=NEW.occurred_at
       AND OLD.xp_value>=0 AND NEW.xp_value>OLD.xp_value THEN
      PERFORM novelight_formal_private.scout_30d_try_restore_e2e(NEW.user_id);
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$$;
REVOKE ALL ON FUNCTION
  novelight_formal_private.scout_30d_deferred_restore()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE CONSTRAINT TRIGGER zzzz_scout_30d_deferred_restore
  AFTER INSERT OR UPDATE OR DELETE ON public.scout_xp_ledger
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION
    novelight_formal_private.scout_30d_deferred_restore();
