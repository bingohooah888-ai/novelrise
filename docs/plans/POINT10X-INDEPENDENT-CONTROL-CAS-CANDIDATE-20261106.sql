-- NOVELIGHT Point10x / REVIEW-ONLY INDEPENDENT CONTROL PRIMARY CANDIDATE
-- DO NOT RUN IN THIS TURN. NOT A SUPABASE MIGRATION.
-- Exact OWNER approval, dedicated independent CONTROL PostgreSQL and
-- standalone permission / restore / operator review REQUIRED before deployment.
-- Existing Staging and Production databases MUST NEVER receive this schema.
-- PostgreSQL 15+ syntax; NOT TESTED against a live PostgreSQL instance.
-- SECURITY DEFINER is intentionally proposed ONLY within independent CONTROL.
-- Approve a separate CONTROL owner/role/GRANT design before any activation.
-- No call to this function constitutes GitHub OWNER authentication.
-- The consumed/spent tombstone MUST NEVER be deleted or reset on failure.

BEGIN;

CREATE SCHEMA point10x_control;
REVOKE ALL ON SCHEMA point10x_control FROM PUBLIC;

CREATE TABLE point10x_control.domain_epochs (
  mutation_domain text PRIMARY KEY
    CHECK (mutation_domain = 'issue294-point10x-all-staging-writers'),
  fencing_epoch bigint NOT NULL CHECK (fencing_epoch >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE point10x_control.spent_approvals (
  repo text NOT NULL CHECK (repo = 'bingohooah888-ai/novelrise'),
  issue_number integer NOT NULL CHECK (issue_number = 294),
  comment_id bigint NOT NULL CHECK (comment_id > 0),
  operation text NOT NULL CHECK (operation = 'read-catalog-11-same-snapshot'),
  scope text NOT NULL CHECK (
    scope = 'reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly'
  ),
  main_sha text NOT NULL CHECK (main_sha ~ '^[0-9a-f]{40}$'),
  pr_head_sha text NOT NULL CHECK (pr_head_sha ~ '^[0-9a-f]{40}$'),
  approval_digest text NOT NULL CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
  mutation_domain text NOT NULL DEFAULT 'issue294-point10x-all-staging-writers'
    CHECK (mutation_domain = 'issue294-point10x-all-staging-writers'),
  spent_epoch bigint NOT NULL CHECK (spent_epoch > 0),
  spent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (repo, issue_number, comment_id),
  UNIQUE (repo, issue_number, approval_digest)
);

CREATE FUNCTION point10x_control.claim_once_v1(
  p_repo text,
  p_issue_number integer,
  p_comment_id bigint,
  p_operation text,
  p_scope text,
  p_main_sha text,
  p_pr_head_sha text,
  p_approval_digest text,
  p_expected_epoch bigint
) RETURNS TABLE (consumed boolean, fencing_epoch bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, point10x_control
AS $$
DECLARE
  v_epoch bigint;
  v_spent_comment bigint;
BEGIN
  -- Reject mismatched tuples before acquiring any resources.
  IF p_repo IS DISTINCT FROM 'bingohooah888-ai/novelrise'
    OR p_issue_number IS DISTINCT FROM 294
    OR p_comment_id IS NULL OR p_comment_id <= 0
    OR p_operation IS DISTINCT FROM 'read-catalog-11-same-snapshot'
    OR p_scope IS DISTINCT FROM
      'reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly'
    OR p_main_sha IS NULL OR p_main_sha !~ '^[0-9a-f]{40}$'
    OR p_pr_head_sha IS NULL OR p_pr_head_sha !~ '^[0-9a-f]{40}$'
    OR p_approval_digest IS NULL OR p_approval_digest !~ '^[0-9a-f]{64}$'
    OR p_expected_epoch IS NULL OR p_expected_epoch < 0
  THEN
    RETURN QUERY SELECT FALSE, NULL::bigint;
    RETURN;
  END IF;

  -- This is an independent CONTROL-primary row lock, NEVER a Staging lock.
  -- domain_epochs must be initialized only through a SEPARATE approved operation.
  SELECT de.fencing_epoch INTO v_epoch
  FROM point10x_control.domain_epochs AS de
  WHERE de.mutation_domain = 'issue294-point10x-all-staging-writers'
  FOR UPDATE;

  IF NOT FOUND OR v_epoch IS DISTINCT FROM p_expected_epoch
  THEN
    RETURN QUERY SELECT FALSE, v_epoch;
    RETURN;
  END IF;

  -- Under the same transaction/row lock. Existing claims are terminal.
  -- Unique(comment ID) prevents scope/HEAD relabeling or replay.
  INSERT INTO point10x_control.spent_approvals (
    repo, issue_number, comment_id, operation, scope,
    main_sha, pr_head_sha, approval_digest, spent_epoch
  ) VALUES (
    p_repo, p_issue_number, p_comment_id, p_operation, p_scope,
    p_main_sha, p_pr_head_sha, p_approval_digest, v_epoch + 1
  )
  ON CONFLICT DO NOTHING
  RETURNING comment_id INTO v_spent_comment;

  IF v_spent_comment IS NULL
  THEN
    RETURN QUERY SELECT FALSE, v_epoch;
    RETURN;
  END IF;

  UPDATE point10x_control.domain_epochs AS de
  SET fencing_epoch = v_epoch + 1, updated_at = clock_timestamp()
  WHERE de.mutation_domain = 'issue294-point10x-all-staging-writers';

  RETURN QUERY SELECT TRUE, v_epoch + 1;
END;
$$;

-- PostgreSQL functions receive PUBLIC EXECUTE by default: remove it.
-- Deploy the function/table owner with a NOLOGIN role and bind a dedicated
-- invoker GRANT in a separately approved, reviewed CONTROL-only deployment.
REVOKE ALL ON FUNCTION point10x_control.claim_once_v1(
  text,integer,bigint,text,text,text,text,text,bigint
) FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA point10x_control FROM PUBLIC;

-- Atomic DDL transaction prevents transient PUBLIC EXECUTE exposure.
COMMIT;

-- Any uncertain COMMIT ACK must be resolved by a new read-only query against
-- the authoritative independent CONTROL primary. Never automatically retry
-- or infer "unused" from an absent Issue #294 progress comment.
-- No GRANT, domain initialization, credential, network config, or invocation
-- exists in this candidate file.
