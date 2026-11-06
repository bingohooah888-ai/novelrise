// NOVELIGHT beta Scout Point x10 / SECURITY DEFINER cutover CONTRACT ONLY.
// Trust boundary: this module never connects to a database, invokes a provider,
// submits SQL, modifies a migration, or authorizes deployment.
import { createHash } from 'node:crypto';

export const SCOUT_POINT_10X_RPC_LEGACY_SHA256 =
  '24be8677e21321908b27733eec1005c7bdf394aba32bdaa9de0f7b071e53c1a9';
export const SCOUT_POINT_10X_RPC_LEGACY_PG_MD5 =
  '830b9784d2e7d5bdd71054188aa06e91';
export const SCOUT_POINT_10X_RPC_FUNCTION =
  'public.novelight_award_level_up_points()';
export const SCOUT_POINT_10X_RPC_TRIGGER = 'scout_xp_level_up_points';
export const SCOUT_POINT_10X_ISSUE = 294;
export const SCOUT_POINT_10X_STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
export const SCOUT_POINT_10X_SCOPE = 'reader-reward-beta-point-10x-staging';

const owner = 'postgres';
const acl = Object.freeze(['postgres=X/postgres', 'service_role=X/postgres']);
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const array = (x) => Array.isArray(x);
const frozen = (v) => Object.freeze(v);
const legacyAwardText = "\n      'level_up',\n      5,\n      'confirmed',";
const updatedAwardText = "\n      'level_up',\n      50,\n      'confirmed',";
const readOnly = (status, detail = {}) =>
  frozen({
    status,
    ...detail,
    proposedOnly: true,
    sourceWasExecuted: false,
    sourceCatalogWasIndependentlyVerified: false,
    mayChangeStaging: false,
    mayChangeProduction: false,
    mayAlterFunction: false,
    mayWriteDb: false,
    mayAwardPoints: false,
    mayDeploy: false,
    mayMergeMain: false
  });

export const SCOUT_POINT_10X_KNOWN_WRITERS = frozen([
  'public.novelight_award_level_up_points()',
  'public.novelight_award_level_up_points_rank_internal_20260928()',
  'public.novelight_award_discovery_points_rank_internal_20260928()',
  'public.novelight_apply_scout_badge_evaluation(uuid,text,bigint,numeric,boolean,jsonb,boolean)',
  'public.novelight_apply_scout_badge_progress(uuid,text,bigint,jsonb)',
  'public.novelight_admin_scout_point_action(uuid,text,text,uuid,uuid,timestamp with time zone,integer)'
]);

export const SCOUT_POINT_10X_WRITER_CLASSES = frozen([
  'xp_insert_level_trigger',
  'legacy_rank_internal_xp',
  'discovery_and_event_triggers',
  'badge_evaluation_and_progress',
  'operator_adjustment_and_reversal',
  'direct_service_role_and_privileged_rpcs',
  'scheduled_jobs_edge_and_queues',
  'application_read_comment_award_routes',
  'inflight_retry_and_outbox_workers'
]);

export const SCOUT_POINT_10X_DURABLE_RESOURCES = frozen([
  'approved_main_and_candidate_head_sha_fence',
  'owner_authorized_one_time_staging_scope',
  'independent_full_database_backup_and_restore',
  'verified_read_only_full_row_snapshot_digests',
  'exclusive_writer_pause_across_all_paths',
  'new_old_issuer_unit_barrier',
  'unexposed_unique_durable_unit_marker',
  'marker_ledger_badges_progress_operator_rpc_one_db_transaction',
  'postcutover_rpc_owner_acl_search_path_trigger_parity',
  'no_double_award_and_event_key_integrity',
  'confirmed_pending_frozen_cancelled_and_reversal_preservation',
  'postcutover_complete_independent_ledger_reconciliation',
  'rollback_rehearsal_before_resuming_writers',
  'postcommit_forward_repair_no_stale_snapshot_restore',
  'application_display_history_rpc_and_reader_consistency',
  'separate_production_mutation_scope_and_approval'
]);

const expectedCatalog = (catalog) => {
  const blockers = [];
  if (!record(catalog)) return frozen(['missing_catalog_evidence']);
  if (catalog.signature !== SCOUT_POINT_10X_RPC_FUNCTION)
    blockers.push('unexpected_function_signature');
  if (catalog.owner !== owner) blockers.push('function_owner_drift');
  if (catalog.securityDefiner !== true)
    blockers.push('security_definer_changed');
  if (
    !array(catalog.config) ||
    catalog.config.length !== 1 ||
    !['search_path=""', 'search_path='].includes(catalog.config[0])
  )
    blockers.push('untrusted_search_path');
  if (
    !array(catalog.acl) ||
    catalog.acl.length !== acl.length ||
    acl.some((a) => !catalog.acl.includes(a))
  )
    blockers.push('function_execute_acl_drift');
  if (catalog.language !== 'plpgsql') blockers.push('unexpected_language');
  if (catalog.volatility !== 'v') blockers.push('unexpected_volatility');
  if (
    !record(catalog.trigger) ||
    catalog.trigger.name !== SCOUT_POINT_10X_RPC_TRIGGER ||
    catalog.trigger.table !== 'public.scout_xp_ledger' ||
    catalog.trigger.enabled !== true ||
    catalog.trigger.event !== 'AFTER INSERT' ||
    catalog.trigger.function !== SCOUT_POINT_10X_RPC_FUNCTION
  )
    blockers.push('trigger_attachment_or_state_drift');
  if (catalog.observedFunctionPgMd5 !== SCOUT_POINT_10X_RPC_LEGACY_PG_MD5)
    blockers.push('catalog_function_digest_drift');
  return frozen(blockers);
};

/**
 * Deterministic draft SQL candidate: prove a single 5 -> 50 token change
 * inside the *known exact* legacy pg_get_functiondef() source.
 *
 * Caller-supplied catalog attributes are NOT an independent live audit.
 * No executable migration or approval token is emitted.
 */
export function quoteScoutLevelUp50ptDefinerCandidate({
  legacySql,
  catalog
} = {}) {
  const blockers = [...expectedCatalog(catalog)];
  if (typeof legacySql !== 'string') blockers.push('legacy_sql_missing');
  if (typeof legacySql === 'string') {
    if (
      sha(legacySql) !== SCOUT_POINT_10X_RPC_LEGACY_SHA256 ||
      md5(legacySql) !== SCOUT_POINT_10X_RPC_LEGACY_PG_MD5
    )
      blockers.push('legacy_source_exact_digest_mismatch');
    if (legacySql.split(legacyAwardText).length !== 2)
      blockers.push('old_5pt_anchor_not_unique');
    if (
      !legacySql.startsWith(
        'CREATE OR REPLACE FUNCTION public.novelight_award_level_up_points()\n' +
          " RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n"
      )
    )
      blockers.push('source_header_drift');
    if (
      !legacySql.includes('on conflict (event_key) do nothing;') ||
      !legacySql.includes(
        "'level_up:' || new.user_id::text || ':' || v_level::text"
      )
    )
      blockers.push('event_key_or_idempotency_drift');
  }
  if (blockers.length > 0)
    return readOnly('source_or_catalog_drift_hold', {
      blockers: frozen(blockers)
    });
  const proposedSql = legacySql.replace(legacyAwardText, updatedAwardText);
  if (proposedSql.replace(updatedAwardText, legacyAwardText) !== legacySql)
    return readOnly('candidate_diff_not_exclusive_hold');
  return readOnly('source_diff_review_candidate_only', {
    newPointPerLevel: 50,
    oldPointPerLevel: 5,
    baselineSha256: sha(legacySql),
    candidateSha256: sha(proposedSql),
    baselinePgMd5: md5(legacySql),
    changedTokenCount: 1,
    candidateSql: proposedSql,
    mustPreserveDefiner: true,
    mustPreserveOwner: true,
    mustPreserveSearchPath: true,
    mustPreserveAcl: true,
    mustPreserveTriggerAttachment: true,
    mustPreserveUniqueEventKeyAndConflictPolicy: true,
    requiresOutOfBandCatalogRecheck: true,
    requiresSeparateStagingApproval: true,
    requiresSeparateProductionApproval: true
  });
}

/** Read-only comparison with the exact generated candidate. */
export function quoteScoutDefinerParity({
  legacySql,
  candidateSql,
  catalog
} = {}) {
  const base = quoteScoutLevelUp50ptDefinerCandidate({ legacySql, catalog });
  if (base.status !== 'source_diff_review_candidate_only')
    return readOnly('parity_unverified_hold', { blockers: base.blockers });
  const equal = candidateSql === base.candidateSql;
  return readOnly(
    equal ? 'exact_single_token_parity_only' : 'definer_candidate_drift_hold',
    {
      matchesApprovedDiff: equal,
      originalDefinerUnchanged: equal,
      originalSignatureUnchanged: equal,
      originalEventKeysUnchanged: equal,
      ownerAndGrantsRequirePostSqlAudit: true,
      originalSha256: base.baselineSha256,
      proposedSha256: base.candidateSha256
    }
  );
}

/**
 * Every known path and every dynamic writer class must be surveyed.
 * "paused" statements from a caller can never enable mutation.
 */
export function quoteScoutOldUnitWriterStop({
  paths = [],
  classEvidence = {},
  observedActiveTriggers = [],
  unclassifiedDirectWrites = null,
  inflightOperations = null,
  durableFenceVerified = false
} = {}) {
  if (!array(paths) || !record(classEvidence) || !array(observedActiveTriggers))
    throw new TypeError('Writer inventory must be structured');
  const blockers = [];
  const named = new Set();
  for (const item of paths) {
    if (!record(item) || typeof item.name !== 'string')
      throw new TypeError('Writer inventory entry malformed');
    if (named.has(item.name)) blockers.push('duplicate_writer:' + item.name);
    named.add(item.name);
    if (
      !['paused', 'legacy_dormant_verified', 'unverified', 'active'].includes(
        item.state
      )
    )
      blockers.push('invalid_writer_status:' + item.name);
    if (!['paused', 'legacy_dormant_verified'].includes(item.state))
      blockers.push('writer_not_fenced:' + item.name);
  }
  for (const name of SCOUT_POINT_10X_KNOWN_WRITERS) {
    if (!named.has(name)) blockers.push('unreviewed_known_writer:' + name);
  }
  for (const category of SCOUT_POINT_10X_WRITER_CLASSES) {
    if (classEvidence[category] !== 'independently_audited_paused')
      blockers.push('writer_class_not_proven:' + category);
  }
  if (!observedActiveTriggers.includes(SCOUT_POINT_10X_RPC_TRIGGER))
    blockers.push('active_xp_trigger_not_accounted_for');
  if (!integer(unclassifiedDirectWrites) || unclassifiedDirectWrites > 0)
    blockers.push('unclassified_direct_db_writers');
  if (!integer(inflightOperations) || inflightOperations > 0)
    blockers.push('inflight_awards_or_retries');
  if (durableFenceVerified !== true)
    blockers.push('database_enforced_writer_fence_unverified');
  return readOnly(
    blockers.length === 0
      ? 'all_caller_claims_complete_but_independent_proof_required'
      : 'old_unit_writers_not_fully_fenced_hold',
    {
      blockers: frozen(blockers),
      knownWriterPaths: SCOUT_POINT_10X_KNOWN_WRITERS,
      requiredClasses: SCOUT_POINT_10X_WRITER_CLASSES,
      cannotInferNoHiddenWriters: true,
      requiresDbLockAndLiveCatalogRecheck: true,
      requiresNoOldAndNewValueInterleaving: true,
      requiresNoServiceRoleBypass: true,
      safeToResume: false
    }
  );
}

/** Contracts for a unique one-time cutover marker; never creates one. */
export function quoteScoutDurableMarker({
  scope,
  fromUnit,
  toUnit,
  markerSchema,
  markerConstraint,
  writerUnitBarrier = false,
  atomicallyCommittedWithAllPointTablesAndRpc = false,
  immutableAuditPreserved = false,
  principalCanWriteMarker = true
} = {}) {
  const blockers = [];
  if (scope !== SCOUT_POINT_10X_SCOPE) blockers.push('scope_mismatch');
  if (fromUnit !== '1pt_per_yen' || toUnit !== '10pt_per_yen')
    blockers.push('unit_version_drift');
  if (markerSchema !== 'private_non_exposed')
    blockers.push('exposed_or_unverified_marker_schema');
  if (markerConstraint !== 'unique_cutover_id_and_target_unit')
    blockers.push('durable_unique_claim_unverified');
  if (writerUnitBarrier !== true) blockers.push('unit_writer_barrier_missing');
  if (atomicallyCommittedWithAllPointTablesAndRpc !== true)
    blockers.push('atomic_marker_and_rpc_commit_unverified');
  if (immutableAuditPreserved !== true)
    blockers.push('original_event_provenance_not_preserved');
  if (principalCanWriteMarker !== false)
    blockers.push('untrusted_principal_may_modify_marker');
  return readOnly(
    blockers.length
      ? 'durable_marker_design_unverified_hold'
      : 'durable_marker_designed_not_implemented',
    {
      blockers: frozen(blockers),
      requiredUniqueness: '(cutover_scope, target_unit_version)',
      requiredResources: frozen([
        'private cutover marker unique constraint',
        'staged source-version and final-version state',
        'one atomic DB commit including five data surfaces and RPC',
        'unambiguous status after crash or reconnect',
        'restricted marker privilege and audited operator',
        'per-user ledger conservation and reversal reference parity'
      ]),
      markerCreated: false,
      migrationApplied: false,
      mayRerunConversion: false
    }
  );
}

export const SCOUT_POINT_10X_DEPENDENCY_ORDER = frozen([
  '01_read_only_current_main_master_safety_and_pr_inventory',
  '02_owner_approved_scoped_issue_294_workflow_on_trusted_main',
  '03_independently_audited_all_old_unit_writer_paths',
  '04_full_staging_backup_and_independent_restore_proved',
  '05_postgres_function_owner_acl_search_path_trigger_snapshot',
  '06_db_enforced_fence_and_old_writer_quiescence',
  '07_unique_private_durable_unit_marker_and_snapshot_fence',
  '08_single_transaction_ledger_badge_threshold_progress_operator_rpc',
  '09_full_row_event_status_xp_and_acl_postcutover_reconciliation',
  '10_fault_injection_and_recovery_rollback_before_writer_resume',
  '11_explicit_staging_reopen_and_ui_read_consistency_proof',
  '12_separate_owner_approved_production_mutation_gate'
]);

/**
 * Caller-provided yes/no evidence is documentation, not authenticated proof.
 * Full review, approved main workflow, Staging proof and separate Production
 * approval are not obtainable from this pure function.
 */
export function quoteScoutPointTenfoldCutoverReadiness({
  requirementStatus = {},
  priorRollbackOnlyProof = false,
  rpcParity,
  writerStop,
  durableMarker
} = {}) {
  if (!record(requirementStatus))
    throw new TypeError('requirements must be an object');
  const unmet = [];
  for (const k of SCOUT_POINT_10X_DURABLE_RESOURCES) {
    if (requirementStatus[k] !== 'independently_verified') unmet.push(k);
  }
  if (priorRollbackOnlyProof !== true)
    unmet.push('standalone_rollback_only_sql_proof_not_authenticated');
  if (rpcParity?.status !== 'exact_single_token_parity_only')
    unmet.push('rpc_source_parity_not_established');
  if (
    writerStop?.status !==
    'all_caller_claims_complete_but_independent_proof_required'
  )
    unmet.push('all_old_unit_writers_not_stopped');
  if (durableMarker?.status !== 'durable_marker_designed_not_implemented')
    unmet.push('durable_unique_marker_not_designed');
  return readOnly('dependency_analysis_only_not_live_authority', {
    missingOrUnverified: frozen(unmet),
    dependencyOrder: SCOUT_POINT_10X_DEPENDENCY_ORDER,
    requiredResources: SCOUT_POINT_10X_DURABLE_RESOURCES,
    pendingRpcMigration: true,
    pendingWriterFreeze: true,
    pendingDurableMarkerDDL: true,
    pendingBackupAndIndependentRestore: true,
    stagingMigrationWasRun: false,
    productionMigrationWasRun: false,
    insufficientWithoutNewStagingOwnerApproval: true,
    insufficientWithoutSeparateProductionOwnerApproval: true
  });
}
