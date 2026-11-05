-- TEST-ONLY fixture for a disposable postgres:16-alpine container.
-- Never apply to Supabase, Staging, Production, or an existing database.
DO $local$ BEGIN
  IF current_database() <> 'nl_point10x_control' THEN
    RAISE EXCEPTION 'LOCAL_TEST_CONTROL_DATABASE_REQUIRED' USING ERRCODE='P0001';
  END IF;
END $local$;

CREATE SCHEMA nl_point10x_control;
REVOKE ALL ON SCHEMA nl_point10x_control FROM PUBLIC;

CREATE TABLE nl_point10x_control.domain (
  domain text PRIMARY KEY,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  fencing_epoch bigint NOT NULL DEFAULT 0 CHECK (fencing_epoch >= 0),
  phase text NOT NULL CHECK (phase IN ('idle', 'claimed', 'hold'))
);
INSERT INTO nl_point10x_control.domain (domain) VALUES
  ('issue294-point10x-all-staging-writers');

CREATE TABLE nl_point10x_control.spent (
  issue_number bigint NOT NULL DEFAULT 294 CHECK (issue_number = 294),
  comment_id bigint NOT NULL CHECK (comment_id > 0),
  operation_id text NOT NULL UNIQUE,
  scope text NOT NULL,
  candidate_sha text NOT NULL CHECK (candidate_sha ~ '^[0-9a-f]{40}$'),
  fencing_epoch bigint NOT NULL CHECK (fencing_epoch > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_number, comment_id),
  UNIQUE (scope, candidate_sha),
  UNIQUE (fencing_epoch)
);

-- A deliberately tiny local-only CAS implementation for SQL semantics testing.
-- Real trusted-main authentication, roles, SQL ACLs and durability need other reviews.
CREATE FUNCTION nl_point10x_control.claim_once(
  p_comment_id bigint,
  p_operation_id text,
  p_scope text,
  p_candidate_sha text,
  p_expected_version bigint,
  p_expected_epoch bigint,
  p_hold_seconds double precision DEFAULT 0.0
) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $claim$
DECLARE
  v_epoch bigint;
  v_version bigint;
BEGIN
  SELECT d.fencing_epoch, d.version INTO v_epoch, v_version
    FROM nl_point10x_control.domain d
   WHERE d.domain = 'issue294-point10x-all-staging-writers'
     AND d.phase = 'idle'
   FOR UPDATE;
  IF NOT FOUND OR v_version <> p_expected_version
      OR v_epoch <> p_expected_epoch THEN
    RAISE EXCEPTION 'POINT10X_CAS_BUSY_OR_STALE' USING ERRCODE = 'P0001';
  END IF;
  IF p_hold_seconds > 0.0 THEN
    PERFORM pg_catalog.pg_sleep(p_hold_seconds);
  END IF;
  INSERT INTO nl_point10x_control.spent
    (comment_id, operation_id, scope, candidate_sha, fencing_epoch)
  VALUES
    (p_comment_id, p_operation_id, p_scope, p_candidate_sha, v_epoch + 1);
  UPDATE nl_point10x_control.domain
     SET phase = 'claimed', version = version + 1, fencing_epoch = fencing_epoch + 1
   WHERE domain = 'issue294-point10x-all-staging-writers'
     AND phase = 'idle' AND version = p_expected_version
     AND fencing_epoch = p_expected_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POINT10X_CAS_UPDATE_FAILED' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_epoch + 1;
END
$claim$;
REVOKE ALL ON FUNCTION nl_point10x_control.claim_once(
  bigint, text, text, text, bigint, bigint, double precision
) FROM PUBLIC;
