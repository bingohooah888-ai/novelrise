-- NOVELIGHT Scout formal 30-day source-finality and correction holds.
-- Staging only / internal E2E only. No reviewed levels, XP, users or claims changed.
-- Both existing release and E2E cutover controls are constrained to enabled=false.
-- Never treat this migration as a source-completeness certificate.
-- Rollback (separate approval): DROP the 4 triggers, then the 4 functions,
-- then scout_30d_compensation_hold. No automatic rollback is executed.

CREATE TABLE novelight_formal_private.scout_30d_compensation_hold (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_end_at timestamptz NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('event','light_seed','rank','xp')),
  source_id uuid NOT NULL,
  change_kind text NOT NULL CHECK (change_kind IN ('INSERT','UPDATE','DELETE')),
  occurred_at timestamptz NOT NULL,
  awarded_xp_at_review integer NOT NULL,
  before_level smallint NOT NULL,
  after_level smallint NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
  occurrences integer NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  detected_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (user_id,window_end_at,source_kind,source_id,change_kind)
);
ALTER TABLE novelight_formal_private.scout_30d_compensation_hold
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON novelight_formal_private.scout_30d_compensation_hold
  FROM PUBLIC,anon,authenticated,service_role;

-- A source change is serialized with the per-reader XP/review advisory lock.
-- The source and hold stay in one DB transaction. Review history is NEVER
-- revised or cleared by this recorder; pending compensation is durable.
CREATE FUNCTION novelight_formal_private.scout_30d_record_pending_correction(
  p_user_id uuid,p_source_kind text,p_source_id uuid,
  p_change_kind text,p_occurred_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL OR p_source_id IS NULL OR p_occurred_at IS NULL
    OR p_source_kind NOT IN ('event','light_seed','rank','xp')
    OR p_change_kind NOT IN ('INSERT','UPDATE','DELETE') THEN
    RETURN;
  END IF;
  -- Preserve all beta paths. No effect until an independently approved
  -- release removes the existing DB CHECK(enabled=false), which this
  -- migration does not do.
  IF NOT EXISTS (
    SELECT 1 FROM novelight_formal_private.scout_30d_release_control g
    WHERE g.singleton AND g.enabled
  ) THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    JOIN novelight_formal_private.scout_30d_e2e_cutover c
      ON c.user_id=u.id AND c.enabled
    WHERE u.id=p_user_id
      AND u.raw_app_meta_data->>'internal_e2e'='true'
  ) THEN RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'novelight:scout-formal-xp-review:v1:'||p_user_id::text,0
    )
  );
  -- A new or corrected event after source closure forces a hold.
  UPDATE novelight_formal_private.scout_30d_window_evidence e
    SET source_evidence_verified=false,late_issue=true
   WHERE e.user_id=p_user_id AND p_occurred_at<e.window_end_at;
  -- A window that was already reviewed requires compensation examination,
  -- never silent acceptance, deletion of the claim or automatic redemotion.
  INSERT INTO novelight_formal_private.scout_30d_compensation_hold (
    user_id,window_end_at,source_kind,source_id,change_kind,occurred_at,
    awarded_xp_at_review,before_level,after_level
  )
  SELECT r.user_id,r.window_end_at,p_source_kind,p_source_id,p_change_kind,
         p_occurred_at,r.awarded_xp,r.before_level,r.after_level
    FROM novelight_formal_private.scout_review_claim r
   WHERE r.user_id=p_user_id
     AND p_occurred_at>=r.window_end_at-interval '30 days'
     AND p_occurred_at<r.window_end_at
  ON CONFLICT (user_id,window_end_at,source_kind,source_id,change_kind)
  DO UPDATE SET
    occurrences=novelight_formal_private.scout_30d_compensation_hold.occurrences+1,
    last_seen_at=pg_catalog.clock_timestamp();
END
$$;
REVOKE ALL ON FUNCTION
  novelight_formal_private.scout_30d_record_pending_correction(
    uuid,text,uuid,text,timestamptz
  ) FROM PUBLIC,anon,authenticated,service_role;

-- Handle original ingress BEFORE its AFTER XP-awarding triggers can run.
-- Source event receipt and XP issuance share the same transaction.
CREATE FUNCTION novelight_formal_private.scout_30d_guard_source_ingress()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_old_uid uuid;
  v_new_uid uuid;
  v_uid uuid;
  v_old_at timestamptz;
  v_new_at timestamptz;
  v_old_id uuid;
  v_new_id uuid;
  v_kind text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM novelight_formal_private.scout_30d_release_control g
    WHERE g.singleton AND g.enabled
  ) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='scout_event_ledger' THEN
    v_kind:='event';
    IF TG_OP<>'INSERT' THEN
      v_old_uid:=OLD.user_id;v_old_at:=OLD.occurred_at;v_old_id:=OLD.id;
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_new_uid:=NEW.user_id;v_new_at:=NEW.occurred_at;v_new_id:=NEW.id;
    END IF;
  ELSIF TG_TABLE_NAME='light_seeds' THEN
    v_kind:='light_seed';
    IF TG_OP<>'INSERT' THEN
      v_old_uid:=OLD.reader_id;v_old_at:=OLD.seeded_at;v_old_id:=OLD.id;
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_new_uid:=NEW.reader_id;v_new_at:=NEW.seeded_at;v_new_id:=NEW.id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unexpected source table';
  END IF;
  -- For user transfers, always acquire locks in a globally stable order.
  FOR v_uid IN
    SELECT id FROM (
      SELECT DISTINCT id FROM
      (VALUES (v_old_uid),(v_new_uid)) AS x(id)
      WHERE id IS NOT NULL
    ) AS distinct_ids ORDER BY id::text
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'novelight:scout-formal-xp-review:v1:'||v_uid::text,0
      )
    );
  END LOOP;
  IF TG_OP='INSERT' THEN
    PERFORM novelight_formal_private.scout_30d_record_pending_correction(
      v_new_uid,v_kind,v_new_id,TG_OP,v_new_at
    );
  ELSIF TG_OP='DELETE' THEN
    PERFORM novelight_formal_private.scout_30d_record_pending_correction(
      v_old_uid,v_kind,v_old_id,TG_OP,v_old_at
    );
  ELSIF v_old_uid IS NOT DISTINCT FROM v_new_uid THEN
    PERFORM novelight_formal_private.scout_30d_record_pending_correction(
      v_new_uid,v_kind,v_new_id,TG_OP,least(v_old_at,v_new_at)
    );
  ELSE
    PERFORM novelight_formal_private.scout_30d_record_pending_correction(
      v_old_uid,v_kind,v_old_id,TG_OP,v_old_at
    );
    PERFORM novelight_formal_private.scout_30d_record_pending_correction(
      v_new_uid,v_kind,v_new_id,TG_OP,v_new_at
    );
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION
  novelight_formal_private.scout_30d_guard_source_ingress()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER aa_scout_30d_event_ingress_hold
  BEFORE INSERT OR UPDATE OR DELETE ON public.scout_event_ledger
  FOR EACH ROW EXECUTE FUNCTION
    novelight_formal_private.scout_30d_guard_source_ingress();
CREATE TRIGGER aa_scout_30d_light_seed_ingress_hold
  BEFORE INSERT OR UPDATE OR DELETE ON public.light_seeds
  FOR EACH ROW EXECUTE FUNCTION
    novelight_formal_private.scout_30d_guard_source_ingress();

-- Ranking is a potential discovery XP source before the seed-state trigger.
-- Pre-lock all impacted internal E2E readers in reader-ID order, not after
-- acquiring seed-state FOR UPDATE. Closed beta gates short-circuit to no-op.
CREATE FUNCTION novelight_formal_private.scout_30d_guard_rank_ingress()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_old_novel text;
  v_new_novel text;
  v_event_id uuid;
  v_at timestamptz;
  v_uid uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM novelight_formal_private.scout_30d_release_control g
    WHERE g.singleton AND g.enabled
  ) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP<>'INSERT' THEN
    v_old_novel:=OLD.novel_id_snapshot;v_at:=OLD.occurred_at;
    v_event_id:=OLD.id;
  END IF;
  IF TG_OP<>'DELETE' THEN
    v_new_novel:=NEW.novel_id_snapshot;
    IF v_at IS NULL THEN v_at:=NEW.occurred_at;
    ELSE v_at:=least(v_at,NEW.occurred_at); END IF;
    v_event_id:=NEW.id;
  END IF;
  FOR v_uid IN
    SELECT DISTINCT s.reader_id FROM public.seed_discovery_state s
    JOIN auth.users u ON u.id=s.reader_id
      AND u.raw_app_meta_data->>'internal_e2e'='true'
    JOIN novelight_formal_private.scout_30d_e2e_cutover c
      ON c.user_id=s.reader_id AND c.enabled
    WHERE s.novel_id_snapshot=v_old_novel
       OR s.novel_id_snapshot=v_new_novel
    ORDER BY s.reader_id
  LOOP
    PERFORM novelight_formal_private.scout_30d_record_pending_correction(
      v_uid,'rank',v_event_id,TG_OP,v_at
    );
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION
  novelight_formal_private.scout_30d_guard_rank_ingress()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER aa_scout_30d_rank_ingress_hold
  BEFORE INSERT OR UPDATE OR DELETE ON public.novel_rank_events
  FOR EACH ROW EXECUTE FUNCTION
    novelight_formal_private.scout_30d_guard_rank_ingress();

-- A confirmed XP ledger correction is observed after the beta cap and its
-- BEFORE guard. Do not change the awarded XP or review/level state here.
CREATE FUNCTION novelight_formal_private.scout_30d_guard_committed_xp()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM novelight_formal_private.scout_30d_record_pending_correction(
      NEW.user_id,'xp',NEW.id,TG_OP,NEW.occurred_at
    );
  ELSIF TG_OP='DELETE' THEN
    PERFORM novelight_formal_private.scout_30d_record_pending_correction(
      OLD.user_id,'xp',OLD.id,TG_OP,OLD.occurred_at
    );
  ELSIF OLD.user_id IS NOT DISTINCT FROM NEW.user_id THEN
    PERFORM novelight_formal_private.scout_30d_record_pending_correction(
      NEW.user_id,'xp',NEW.id,TG_OP,least(OLD.occurred_at,NEW.occurred_at)
    );
  ELSE
    PERFORM novelight_formal_private.scout_30d_record_pending_correction(
      OLD.user_id,'xp',OLD.id,TG_OP,OLD.occurred_at
    );
    PERFORM novelight_formal_private.scout_30d_record_pending_correction(
      NEW.user_id,'xp',NEW.id,TG_OP,NEW.occurred_at
    );
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION
  novelight_formal_private.scout_30d_guard_committed_xp()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zz_scout_30d_xp_compensation_hold
  AFTER INSERT OR UPDATE OR DELETE ON public.scout_xp_ledger
  FOR EACH ROW EXECUTE FUNCTION
    novelight_formal_private.scout_30d_guard_committed_xp();

-- Read-only inspection reports pending review/compensation, not "sealed".
-- It is never an authority that can set source_evidence_verified=true.
CREATE FUNCTION novelight_formal_private.scout_30d_inspect_finality_e2e(
  p_user_id uuid,p_window_end timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_holds bigint;
  v_late bigint;
  v_xp bigint;
  v_awarded integer;
  v_before smallint;
  v_after smallint;
BEGIN
  IF p_user_id IS NULL OR p_window_end IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id=p_user_id
      AND u.raw_app_meta_data->>'internal_e2e'='true'
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status','held_unknown_reader');
  END IF;
  SELECT count(*) INTO v_holds
    FROM novelight_formal_private.scout_30d_compensation_hold h
   WHERE h.user_id=p_user_id AND h.window_end_at=p_window_end
     AND h.status='pending';
  SELECT count(*) INTO v_late
    FROM novelight_formal_private.scout_30d_late_issue i
   WHERE i.user_id=p_user_id AND i.occurred_at<p_window_end
     AND i.occurred_at>=p_window_end-interval '30 days';
  SELECT coalesce(sum(x.xp_value),0) INTO v_xp
    FROM public.scout_xp_ledger x
   WHERE x.user_id=p_user_id
     AND x.occurred_at>=p_window_end-interval '30 days'
     AND x.occurred_at<p_window_end;
  SELECT r.before_level,r.after_level,r.awarded_xp
    INTO v_before,v_after,v_awarded
    FROM novelight_formal_private.scout_review_claim r
   WHERE r.user_id=p_user_id AND r.window_end_at=p_window_end;
  RETURN pg_catalog.jsonb_build_object(
    'status',CASE WHEN v_holds>0 OR v_late>0
      THEN 'held_correction_pending' ELSE 'held_source_finality_unverified' END,
    'source_finality_verified',false,
    'pending_compensation',v_holds,
    'late_issues',v_late,
    'observed_window_xp',v_xp,
    'review_awarded_xp',v_awarded,
    'restore_level_candidate',coalesce(
      v_after<v_before AND v_xp>=200,false
    )
  );
END
$$;
REVOKE ALL ON FUNCTION
  novelight_formal_private.scout_30d_inspect_finality_e2e(uuid,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;

-- No SET enabled=true, no finality proof, no review RPC call,
-- no XP/backfill UPDATE, no claim or level mutation, no cron.
