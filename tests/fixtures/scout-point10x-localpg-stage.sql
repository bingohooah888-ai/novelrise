-- TEST-ONLY schema in nl_point10x_stage disposable database, never Supabase.
-- Use distinct CONTROL and STAGE databases to preserve the cross-DB crash window.
DO $local$ BEGIN
  IF current_database() <> 'nl_point10x_stage' THEN
    RAISE EXCEPTION 'LOCAL_TEST_STAGE_DATABASE_REQUIRED' USING ERRCODE='P0001';
  END IF;
END $local$;

CREATE ROLE nl_point10x_fake_service LOGIN BYPASSRLS;
CREATE SCHEMA nl_point10x_stage;
REVOKE ALL ON SCHEMA nl_point10x_stage FROM PUBLIC;
GRANT USAGE ON SCHEMA nl_point10x_stage TO nl_point10x_fake_service;

CREATE TABLE nl_point10x_stage.fence (
  domain text PRIMARY KEY,
  fencing_epoch bigint NOT NULL DEFAULT 0 CHECK (fencing_epoch >= 0),
  frozen boolean NOT NULL DEFAULT false
);
INSERT INTO nl_point10x_stage.fence (domain)
  VALUES ('issue294-point10x-all-staging-writers');

CREATE TABLE nl_point10x_stage.point_ledger (
  id integer PRIMARY KEY,
  point_value bigint NOT NULL CHECK (point_value >= 0)
);
ALTER TABLE nl_point10x_stage.point_ledger ENABLE ROW LEVEL SECURITY;
-- Local actor intentionally BYPASSRLS to emulate a service_role path.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE
  ON nl_point10x_stage.point_ledger TO nl_point10x_fake_service;

CREATE FUNCTION nl_point10x_stage.require_unfrozen()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fence$
DECLARE v_frozen boolean;
BEGIN
  SELECT f.frozen INTO v_frozen
    FROM nl_point10x_stage.fence f
   WHERE f.domain = 'issue294-point10x-all-staging-writers'
   FOR SHARE;
  IF NOT FOUND OR v_frozen IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'POINT10X_FENCE_DENY' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSIF TG_OP = 'TRUNCATE' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$fence$;
REVOKE ALL ON FUNCTION nl_point10x_stage.require_unfrozen() FROM PUBLIC;

CREATE TRIGGER nl_point10x_row_fence
  BEFORE INSERT OR UPDATE OR DELETE
  ON nl_point10x_stage.point_ledger
  FOR EACH ROW EXECUTE FUNCTION nl_point10x_stage.require_unfrozen();
CREATE TRIGGER nl_point10x_truncate_fence
  BEFORE TRUNCATE
  ON nl_point10x_stage.point_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION nl_point10x_stage.require_unfrozen();

-- Deliberate privileged legacy 5pt pathway: SECURITY DEFINER execution
-- must not bypass the DATA PLANE trigger. This is NOT the production RPC.
CREATE FUNCTION nl_point10x_stage.synthetic_legacy_award_5(p_id integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $award$
BEGIN
  INSERT INTO nl_point10x_stage.point_ledger (id, point_value)
  VALUES (p_id, 5);
END
$award$;
REVOKE ALL ON FUNCTION nl_point10x_stage.synthetic_legacy_award_5(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nl_point10x_stage.synthetic_legacy_award_5(integer)
  TO nl_point10x_fake_service;
