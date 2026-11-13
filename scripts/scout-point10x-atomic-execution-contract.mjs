// Trusted-main INTENDED review module for Point10x atomic Staging cutover.
// NO execute, SQL connection, workflow dispatch, file writes or provider calls.
// Neither this module nor caller-provided evidence can authorize mutations.
import { createHash } from 'node:crypto';
import {
  SCOUT_POINT_10X_WRITER_CLASSES,
  SCOUT_POINT_10X_KNOWN_WRITERS,
  quoteScoutLevelUp50ptDefinerCandidate,
  quoteScoutDefinerParity
} from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';

export const ATOMIC_POINT10X_SCOPE =
  'reader-reward-beta-point-10x-staging-atomic';
export const LEGACY_PROOF_SCOPE = 'reader-reward-beta-point-10x-staging';
export const ATOMIC_REVIEW_MODE = 'contract-review-only';
export const STAGING_PROJECT = 'wmlzjgvxgoyrovdhbqbg';
export const PRODUCTION_PROJECT = 'fiepaguycecrredwrcwx';
export const ISSUE_NUMBER = 294;
export const MARKER_SQL_SHA256 =
  '8f00276cc74a3a821aa7ef93f0bcf7d5f1e552d9b13b05b3a433a3db02129656';
export const PRIVATE_SCHEMA = 'novelight_reward_private';
export const MARKER_TABLE = 'novelight_reward_private.point_unit_cutovers';
export const TRUSTED_DEFINER = 'public.novelight_award_level_up_points()';
export const WRITER_DB_RELATIONS = Object.freeze([
  'public.scout_xp_ledger',
  'public.scout_point_ledger',
  'public.scout_badge_definitions',
  'public.user_scout_badges',
  'public.scout_point_operator_actions'
]);
export const NECESSARY_DDL_CLAUSES = Object.freeze([
  'CREATE SCHEMA novelight_reward_private;',
  'REVOKE ALL ON SCHEMA novelight_reward_private FROM PUBLIC;',
  'REVOKE ALL ON SCHEMA novelight_reward_private FROM anon, authenticated, service_role;',
  'CREATE TABLE novelight_reward_private.point_unit_cutovers (',
  'cutover_id uuid PRIMARY KEY,',
  'UNIQUE (cutover_scope, target_unit_version)',
  'UNIQUE (approval_comment_id)',
  'ENABLE ROW LEVEL SECURITY;',
  'FORCE ROW LEVEL SECURITY;',
  'REVOKE ALL ON TABLE novelight_reward_private.point_unit_cutovers FROM PUBLIC;',
  'REVOKE ALL ON TABLE novelight_reward_private.point_unit_cutovers FROM anon, authenticated, service_role;'
]);
export const REQUIRED_EXECUTION_EVIDENCE = Object.freeze([
  'owner_issue294_approved_new_atomic_scope_and_mode_once',
  'latest_main_and_candidate_sha_still_current',
  'trusted_main_executing_signed_reviewed_code',
  'independent_staging_target_and_production_exclusion',
  'complete_backup_and_independent_restore_verified',
  'all_nine_writer_classes_and_legacy_rpcs_inventory',
  'service_role_direct_sql_and_bypassrls_access_fenced',
  'all_cron_edge_retries_drained',
  'staging_xp_point_badge_operator_db_locks_and_fence',
  'precommit_atomicity_and_fault_injection_verified',
  'no_existing_target_marker_or_unknown_unit_version',
  'private_marker_schema_absent_or_reviewed_collision',
  'private_schema_not_in_data_api_and_no_public_privileges',
  'marker_ddl_exact_sha_reviewed_and_owner_permissions_reviewed',
  'exact_5_to_50_secdef_source_and_catalog_parity',
  'postcutover_definer_owner_acl_search_path_trigger_parity',
  'event_key_reversal_xp_earned_and_full_row_reconciliation',
  'commit_outcome_and_postcommit_event_journal_recovery',
  'reopen_requires_fresh_owner_authorization',
  'production_requires_independent_owner_approval'
]);

const sha256 = (text) =>
  createHash('sha256').update(text, 'utf8').digest('hex');
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isSha = (s) => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);
const freeze = (x) => Object.freeze(x);
const conclusion = (status, additional = {}) =>
  freeze({
    status,
    ...additional,
    stage: 'contract_review_only',
    externallyVerified: false,
    liveProof: false,
    approvalConsumed: false,
    mayRunStaging: false,
    mayPersistStaging: false,
    mayWriteProduction: false,
    mayCreateSchema: false,
    mayGrantPrivileges: false,
    mayAlterSecurityDefiner: false,
    mayStopWriters: false,
    mayMergeMain: false,
    mayDeploy: false,
    mayTransferValue: false,
    mayRunAI: false
  });

export function reviewScout10xAtomicApproval({
  mainSha,
  candidateSha,
  prDraft,
  issueNumber,
  scope,
  mode,
  stagingProject,
  owner,
  triggeringActor,
  authorAssociation,
  trustedCodeOnMain = false,
  oneTimeClaimUnused = false,
  reviewedMarkerSqlSha256
} = {}) {
  const blockers = [];
  if (!isSha(mainSha) || !isSha(candidateSha) || mainSha === candidateSha)
    blockers.push('invalid_main_or_candidate_sha');
  if (prDraft !== true) blockers.push('candidate_must_remain_draft');
  if (
    issueNumber !== ISSUE_NUMBER ||
    owner !== 'bingohooah888-ai' ||
    triggeringActor !== 'bingohooah888-ai' ||
    authorAssociation !== 'OWNER'
  )
    blockers.push('owner_issue_294_identity_unverified');
  if (scope !== ATOMIC_POINT10X_SCOPE || mode !== ATOMIC_REVIEW_MODE)
    blockers.push('wrong_atomic_review_scope_or_mode');
  if (stagingProject !== STAGING_PROJECT)
    blockers.push('wrong_staging_project');
  if (trustedCodeOnMain !== true)
    blockers.push('trusted_main_code_not_verified');
  if (oneTimeClaimUnused !== true) blockers.push('one_time_claim_unverified');
  if (reviewedMarkerSqlSha256 !== MARKER_SQL_SHA256)
    blockers.push('private_marker_sql_digest_not_pinned');
  return conclusion(
    blockers.length
      ? 'approval_review_blocked'
      : 'self_asserted_review_contract_only',
    {
      blockers: freeze(blockers),
      requiresNewScopedOwnerIssueComment: true,
      requiresGitHubIndependentEventAuthentication: true,
      oldRollbackOnlyScopeCannotAuthorizeAtomicCutover: true,
      persistentCutoverRequiresDistinctNewApproval: true,
      expectedScope: ATOMIC_POINT10X_SCOPE
    }
  );
}

/** Explicit, exact contract. Does NOT run or authorize the DDL. */
export function reviewScoutPrivateMarkerDdl({
  sql,
  reportedSchemaExposure,
  reportedActualSchemaExists,
  reportedOwner,
  reportedPublicGrants,
  reportedAnonGrants,
  reportedAuthenticatedGrants,
  reportedServiceRoleGrants
} = {}) {
  if (typeof sql !== 'string' || sql.length > 25000)
    throw new TypeError('bounded SQL required');
  const digest = sha256(sql);
  const blockers = [];
  if (digest !== MARKER_SQL_SHA256)
    blockers.push('marker_source_sha256_not_exact');
  for (const clause of NECESSARY_DDL_CLAUSES) {
    if (!sql.includes(clause))
      blockers.push('missing_expected_ddl_clause:' + clause.slice(0, 50));
  }
  if (!sql.startsWith('-- REVIEW ONLY / DO NOT RUN'))
    blockers.push('review_only_warning_missing');
  if (reportedSchemaExposure !== 'not_exposed_independently_verified')
    blockers.push('private_schema_data_api_exposure_unknown');
  if (reportedActualSchemaExists !== 'absent_independently_verified')
    blockers.push('schema_collision_or_unproven_absence');
  if (reportedOwner !== 'postgres_catalog_verified')
    blockers.push('privileged_operator_owner_unreviewed');
  for (const [role, grants] of Object.entries({
    PUBLIC: reportedPublicGrants,
    anon: reportedAnonGrants,
    authenticated: reportedAuthenticatedGrants,
    service_role: reportedServiceRoleGrants
  })) {
    if (grants !== 'none_independently_verified')
      blockers.push('role_access_not_verified:' + role);
  }
  return conclusion(
    blockers.length
      ? 'private_marker_ddl_review_blocked'
      : 'private_marker_review_candidate_only',
    {
      blockers: freeze(blockers),
      sqlDigestSha256: digest,
      ddlMustNotBeAppliedFromThisFile: true,
      ownerPrivilegesAreNotEnforcedByThisFunction: true,
      ownerBypassRlsStillRequiresIndependentAudit: true,
      markerCreated: false,
      uniqueScopeTargetVersionRequired: true,
      uniqueApprovalCommentRequired: true,
      requiresSeparateDbOperatorApproval: true
    }
  );
}

/** Difference is exactly one 5->50 Point literal; no auto DDL execution. */
export function reviewScoutSecDefinerReplacement({
  legacySql,
  catalog,
  proposedSql
} = {}) {
  const quote = quoteScoutLevelUp50ptDefinerCandidate({ legacySql, catalog });
  const blockers = [];
  if (quote.status !== 'source_diff_review_candidate_only')
    blockers.push('legacy_function_source_or_catalog_drift');
  if (typeof proposedSql !== 'string' || proposedSql !== quote.candidateSql)
    blockers.push('candidate_not_exact_single_reward_token_diff');
  const parity =
    quote.status === 'source_diff_review_candidate_only'
      ? quoteScoutDefinerParity({
          legacySql,
          candidateSql: proposedSql,
          catalog
        })
      : null;
  if (parity?.status !== 'exact_single_token_parity_only')
    blockers.push('definer_parity_not_proven');
  return conclusion(
    blockers.length
      ? 'secdefiner_candidate_review_blocked'
      : 'secdefiner_exact_source_review_candidate_only',
    {
      blockers: freeze(blockers),
      candidateSha256: quote.candidateSha256 ?? null,
      baselineSha256: quote.baselineSha256 ?? null,
      expectedOldReward: 5,
      proposedReward: 50,
      requiresSameOwnerAndExecutionAcl: true,
      requiresEmptySearchPath: true,
      requiresSameXpTriggerAndEventKey: true,
      requiresLivePgFunctionDefinitionAndGrantParity: true,
      existingRollbackCompilerMayNotBeWeakened: true,
      functionReplaced: false
    }
  );
}

/** Entire writer registry must be independently proven, not self-attested. */
export function reviewScoutOldWriterFence({
  writerClasses = [],
  knownFunctions = [],
  relationLocks = [],
  directServiceRoleSql = 'unknown',
  retries = 'unknown',
  cronAndEdge = 'unknown',
  inflight = NaN,
  dbEnforcedUnitBarrier = false,
  existingUnknownTriggers = NaN
} = {}) {
  if (
    !Array.isArray(writerClasses) ||
    !Array.isArray(knownFunctions) ||
    !Array.isArray(relationLocks)
  )
    throw new TypeError('Writer fence inventories must be arrays');
  const blockers = [];
  for (const kind of SCOUT_POINT_10X_WRITER_CLASSES) {
    const entries = writerClasses.filter((e) => isObject(e) && e.name === kind);
    if (entries.length !== 1 || entries[0].status !== 'independently_fenced')
      blockers.push('writer_class_not_fenced:' + kind);
  }
  for (const fn of SCOUT_POINT_10X_KNOWN_WRITERS) {
    const entries = knownFunctions.filter((e) => isObject(e) && e.name === fn);
    if (
      entries.length !== 1 ||
      entries[0].status !== 'reachability_and_unit_fence_audited'
    )
      blockers.push('legacy_function_not_proven_unreachable:' + fn);
  }
  for (const relation of WRITER_DB_RELATIONS) {
    const matched = relationLocks.filter(
      (e) => isObject(e) && e.relation === relation
    );
    if (matched.length !== 1 || matched[0].lock !== 'ACCESS EXCLUSIVE')
      blockers.push('db_lock_not_proven:' + relation);
  }
  if (directServiceRoleSql !== 'independently_blocked')
    blockers.push('service_role_bypass_rls_direct_sql_not_fenced');
  if (retries !== 'independently_drained') blockers.push('retries_not_drained');
  if (cronAndEdge !== 'independently_suspended')
    blockers.push('cron_edge_not_suspended');
  if (!Number.isSafeInteger(inflight) || inflight !== 0)
    blockers.push('inflight_not_zero');
  if (dbEnforcedUnitBarrier !== true)
    blockers.push('db_enforced_unit_barrier_unverified');
  if (
    !Number.isSafeInteger(existingUnknownTriggers) ||
    existingUnknownTriggers !== 0
  )
    blockers.push('unreviewed_trigger_or_function');
  return conclusion(
    blockers.length
      ? 'writer_fence_unverified_hold'
      : 'writer_fence_self_report_only',
    {
      blockers: freeze(blockers),
      allWritersPausedInLiveSystem: false,
      requiresLockedSnapshotAndPostCommitWriterReview: true,
      serviceRoleCanBypassRls: true,
      noAssumptionOfAutomaticDatabaseLockAcrossCommit: true
    }
  );
}

export function reviewScoutAtomicExecutorDependencies({
  approval,
  marker,
  definer,
  writerFence,
  independentlyRestoredBackup = false,
  fullRowReconciliation = false,
  failureInjectionProof = false,
  postCommitRecoveryReviewed = false
} = {}) {
  const mapping = [
    [
      'owner_and_trusted_main_contract',
      approval?.status === 'self_asserted_review_contract_only'
    ],
    [
      'private_schema_marker_ddl',
      marker?.status === 'private_marker_review_candidate_only'
    ],
    [
      'exact_security_definer_change',
      definer?.status === 'secdefiner_exact_source_review_candidate_only'
    ],
    [
      'all_writer_paths_and_locks',
      writerFence?.status === 'writer_fence_self_report_only'
    ],
    [
      'full_backup_and_independent_restore',
      independentlyRestoredBackup === true
    ],
    [
      'immutable_full_row_and_rpc_reconciliation',
      fullRowReconciliation === true
    ],
    ['fault_injection_before_and_after_commit', failureInjectionProof === true],
    [
      'forward_repair_after_new_point_awards',
      postCommitRecoveryReviewed === true
    ]
  ];
  const blockers = mapping.filter(([, v]) => !v).map(([k]) => k);
  return conclusion(
    blockers.length
      ? 'atomic_executor_dependency_hold'
      : 'all_claimed_evidence_still_not_authorization',
    {
      blockers: freeze(blockers),
      requiredEvidence: REQUIRED_EXECUTION_EVIDENCE,
      noTrustedMainAtomicRunnerImplemented: true,
      persistentStagingApprovalNotImplemented: true,
      realMarkerNotCreated: true,
      writerFenceNotApplied: true,
      realRpcNotReplaced: true,
      realBackupNotRestored: true,
      prohibitsReuseOfOldScope: true,
      actualExecutionRequiresNewIndependentGate: true
    }
  );
}
