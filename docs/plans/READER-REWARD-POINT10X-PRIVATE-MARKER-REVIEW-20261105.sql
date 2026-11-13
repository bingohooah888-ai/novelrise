-- REVIEW ONLY / DO NOT RUN / NOT A SUPABASE MIGRATION.
-- βScout Point 10x private marker DDL proposal. This file must never be
-- executed by current CI, issue_comment workflows, migrations or Staging.
-- Supabase Data API exposure, existing schema collisions, owner and privilege
-- configuration require independent catalog review before any future approval.
CREATE SCHEMA novelight_reward_private;
REVOKE ALL ON SCHEMA novelight_reward_private FROM PUBLIC;
REVOKE ALL ON SCHEMA novelight_reward_private FROM anon, authenticated, service_role;

CREATE TABLE novelight_reward_private.point_unit_cutovers (
  cutover_id uuid PRIMARY KEY,
  cutover_scope text NOT NULL
    CHECK (cutover_scope = 'reader-reward-beta-point-10x-staging-atomic'),
  source_unit_version text NOT NULL
    CHECK (source_unit_version = '1pt_per_yen'),
  target_unit_version text NOT NULL
    CHECK (target_unit_version = '10pt_per_yen'),
  approval_comment_id bigint NOT NULL CHECK (approval_comment_id > 0),
  approved_main_sha text NOT NULL CHECK (approved_main_sha ~ '^[0-9a-f]{40}$'),
  approved_candidate_sha text NOT NULL CHECK (approved_candidate_sha ~ '^[0-9a-f]{40}$'),
  source_row_digest_sha256 text NOT NULL CHECK (source_row_digest_sha256 ~ '^[0-9a-f]{64}$'),
  operator_identity text NOT NULL CHECK (char_length(operator_identity) BETWEEN 1 AND 160),
  committed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (cutover_scope, target_unit_version),
  UNIQUE (approval_comment_id)
);
ALTER TABLE novelight_reward_private.point_unit_cutovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE novelight_reward_private.point_unit_cutovers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE novelight_reward_private.point_unit_cutovers FROM PUBLIC;
REVOKE ALL ON TABLE novelight_reward_private.point_unit_cutovers FROM anon, authenticated, service_role;

-- Intentionally no GRANT, no public RPC, no SECURITY DEFINER helper.
-- The trusted, separately approved DB operator role / ownership and
-- SQL atomicity must be audited and decided before this file is made
-- executable in a separately reviewed staging-only path.
