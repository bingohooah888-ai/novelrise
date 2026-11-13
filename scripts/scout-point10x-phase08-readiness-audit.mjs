// NOVELIGHT Scout Point10x phase08: OFFLINE read-only readiness classification.
// The caller's proof flags are untrusted. This module cannot authorize,
// authenticate, read secrets, run a workflow, access a DB, or approve Staging.
import {
  OWNER_LOGIN,
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  SOURCE_RPC_SHA256,
  FIXED_CANDIDATE_RPC_SHA256
} from './scout-point10x-atomic-staging-plan.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  MARKER_SQL_SHA256
} from './scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from './scout-point10x-durable-fence-model.mjs';
import {
  RECOVERY_WRITER_CLASSES,
  RECOVERY_RELATIONS
} from './scout-point10x-recovery-drain-model.mjs';

export const PHASE08_REFERENCE = Object.freeze({
  mainSha: '03f64b14138ec5c6a90c0d8231a0784f878e78fa',
  mainMasterBlobSha: '91d11fa367b7de64990b13397b13d4bb6e3c0230',
  primaryPr: 2762,
  primaryBranch: 'feature/reader-reward-gate01-20261104',
  baselineHeadSha: 'f059e8e9b22088c6a67b25ed32afb6aaa8f6b359',
  candidatePr: 2763,
  candidateBranch: 'staging/reader-point10x-rollback-candidate-20261105',
  candidateHeadSha: '58e60ef90801078e097e321590428c4b8b343486',
  issue: 294,
  owner: OWNER_LOGIN,
  stagingProject: STAGING_PROJECT,
  productionProject: PRODUCTION_PROJECT,
  mutationDomain: MUTATION_DOMAIN,
  rollbackScope: ATOMIC_PROOF_SCOPE,
  persistScope: ATOMIC_WRITE_SCOPE,
  rollbackMode: APPROVAL_MODES.proof,
  persistMode: APPROVAL_MODES.persist,
  sourceRpcSha256: SOURCE_RPC_SHA256,
  candidateRpcSha256: FIXED_CANDIDATE_RPC_SHA256,
  markerSqlSha256: MARKER_SQL_SHA256
});

export const PHASE08_INDEPENDENT_GATES = Object.freeze([
  Object.freeze({
    id: 'trusted_main_executor',
    group: 'approval',
    priority: 1,
    next: 'Review and separately authorize a trusted-main executor; do not activate it from this PR'
  }),
  Object.freeze({
    id: 'owner_scoped_one_shot',
    group: 'approval',
    priority: 1,
    next: 'Obtain a fresh Issue #294 OWNER event bound to exact mode/scope/HEAD and one execution'
  }),
  Object.freeze({
    id: 'durable_linearizable_claim',
    group: 'claim',
    priority: 1,
    next: 'Implement a durable unique-key CAS and single-use spent tombstone, checked before secrets'
  }),
  Object.freeze({
    id: 'cross_workflow_mutex',
    group: 'claim',
    priority: 1,
    next: 'Unify all mutable pathways under one independently verified lock and token policy'
  }),
  Object.freeze({
    id: 'data_plane_writer_fence',
    group: 'writers',
    priority: 1,
    next: 'Prove all nine classes plus legacy RPC, direct service_role, Edge/Cron/retry deny stale tokens'
  }),
  Object.freeze({
    id: 'independent_backup_restore',
    group: 'recovery',
    priority: 1,
    next: 'Independently restore a complete, immutable Staging snapshot in an isolated instance'
  }),
  Object.freeze({
    id: 'source_row_rpc_catalog_parity',
    group: 'atomicity',
    priority: 1,
    next: 'Recheck fresh locked rows, marker digest, SECURITY DEFINER owner/ACL/search_path/trigger'
  }),
  Object.freeze({
    id: 'private_marker_rpc_single_commit',
    group: 'atomicity',
    priority: 1,
    next: 'Review a new one-transaction plan for five relations, private marker and 5pt→50pt RPC'
  }),
  Object.freeze({
    id: 'uncertain_commit_requery',
    group: 'recovery',
    priority: 1,
    next: 'Prove durable read-only marker/journal reconciliation after dropped COMMIT acknowledgement'
  }),
  Object.freeze({
    id: 'legitimate_award_conservation',
    group: 'recovery',
    priority: 1,
    next: 'Prove post-snapshot Point/XP/reversal/outbox events cannot be erased by stale restore'
  }),
  Object.freeze({
    id: 'staging_environment_independent_identity',
    group: 'environment',
    priority: 2,
    next: 'With separate permission, validate target identity and secret presence without revealing values'
  }),
  Object.freeze({
    id: 'post_commit_acl_row_writer_reopen',
    group: 'release',
    priority: 2,
    next: 'Separately validate post-commit row/RLS/ACL/trigger parity and deliberate writer reopening'
  })
]);
export const PHASE08_ALLOWED_EVIDENCE_STATES = Object.freeze([
  'not_verified',
  'offline_model_only',
  'read_only_metadata_only',
  'live_claim_untrusted'
]);
const isObject = (x) =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const sha40 = (x) => typeof x === 'string' && /^[a-f0-9]{40}$/u.test(x);
const keys = PHASE08_INDEPENDENT_GATES.map((x) => x.id);
const freeze = (x) => Object.freeze(x);
const output = (state, violations, gates, meta = {}) =>
  freeze({
    state,
    blockingCount: violations.length + gates.length,
    staticViolations: freeze([...violations]),
    unsatisfiedGates: freeze(gates),
    requiredGateCount: PHASE08_INDEPENDENT_GATES.length,
    knownWriterClassCount: RECOVERY_WRITER_CLASSES.length,
    knownRelationCount: RECOVERY_RELATIONS.length,
    ...meta,
    provenance: 'offline_untrusted_static_readiness_review',
    selfReportedEvidenceCannotAuthorize: true,
    requiresNewSeparateOwnerApproval: true,
    approvalConsumed: false,
    actualApprovalVerified: false,
    durableCasConnected: false,
    actualWriterFenced: false,
    backupIndependentlyRestoredInReality: false,
    actualCommitResolved: false,
    dataPlaneVerified: false,
    actualStagingProofCompleted: false,
    mayReadSecrets: false,
    mayPostApprovalOrClaim: false,
    mayWriteDb: false,
    mayRunStaging: false,
    mayResumeWriters: false,
    mayRunSql: false,
    mayChangeProduction: false,
    mayMergeMain: false,
    mayDeploy: false
  });

export function createPoint10xPreApprovalEvidenceFixture() {
  return freeze(Object.fromEntries(keys.map((k) => [k, 'offline_model_only'])));
}

/**
 * Input is read-only metadata collected elsewhere; no API/DB calls here.
 * Even a caller who fills every key with a claim of live evidence is denied.
 * Data-Plane proof, OWNER identity and durable CAS must be checked in a
 * separately approved trusted-main implementation.
 */
export function auditScoutPoint10xPhase08Readiness({
  mainSha,
  masterBlobSha,
  primary,
  sqlCandidate,
  issue,
  workflow,
  evidence
} = {}) {
  const violations = [];
  if (mainSha !== PHASE08_REFERENCE.mainSha || !sha40(mainSha))
    violations.push('main_sha_changed_requires_new_full_preflight');
  if (masterBlobSha !== PHASE08_REFERENCE.mainMasterBlobSha)
    violations.push('master_blob_changed_requires_new_full_preflight');
  if (
    !isObject(primary) ||
    primary.number !== 2762 ||
    primary.headSha !== PHASE08_REFERENCE.baselineHeadSha ||
    primary.baseSha !== mainSha ||
    primary.branch !== PHASE08_REFERENCE.primaryBranch ||
    primary.draft !== true ||
    primary.open !== true ||
    primary.merged !== false
  )
    violations.push('primary_pr_not_baseline_draft');
  if (
    !isObject(sqlCandidate) ||
    sqlCandidate.number !== 2763 ||
    sqlCandidate.headSha !== PHASE08_REFERENCE.candidateHeadSha ||
    sqlCandidate.baseSha !== mainSha ||
    sqlCandidate.branch !== PHASE08_REFERENCE.candidateBranch ||
    sqlCandidate.draft !== true ||
    sqlCandidate.open !== true ||
    sqlCandidate.merged !== false ||
    sqlCandidate.rollbackOnly !== true ||
    sqlCandidate.rpcAltered === true ||
    sqlCandidate.privateMarkerCreated === true
  )
    violations.push('sql_candidate_must_remain_rollback_only_draft');
  if (
    !isObject(issue) ||
    issue.number !== 294 ||
    issue.state !== 'open' ||
    issue.title !== '[Staging Control] Supabase migration sync'
  )
    violations.push('issue_294_incorrect_or_unverified');
  if (
    !isObject(workflow) ||
    workflow.trustedMainAtomicInstalled !== false ||
    workflow.inertFileOutsideWorkflows !== true ||
    workflow.inertEventMapEmpty !== true ||
    workflow.inertJobDisabled !== true ||
    workflow.liveScopeReused !== false ||
    workflow.allLegacyAndAtomicGroupsEqual !== false
  )
    violations.push('workflow_topology_not_verified_at_fixed_baseline');
  if (
    !isObject(evidence) ||
    Object.keys(evidence).length !== keys.length ||
    !keys.every((k) => Object.hasOwn(evidence, k)) ||
    Object.keys(evidence).some((k) => !keys.includes(k))
  )
    violations.push('unrecognized_missing_or_extra_gate_evidence');
  const unsatisfied = PHASE08_INDEPENDENT_GATES.map((def) => {
    const state = evidence?.[def.id];
    const known = PHASE08_ALLOWED_EVIDENCE_STATES.includes(state);
    return freeze({
      id: def.id,
      group: def.group,
      priority: def.priority,
      observed: known ? state : 'invalid_evidence',
      next: def.next,
      mustRemainBlocked: true,
      independentlyAuthenticated: false
    });
  });
  return output(
    'NOT_READY_FOR_LIVE_STAGING_OR_OWNER_APPROVAL_EXECUTION',
    violations,
    unsatisfied,
    {
      checkedOnlyAtBaseline: true,
      projectSeparationRequired: true,
      originalRollbackOnlySqlCannotServeAsAtomicCutover: true,
      existingThreeLockGroupsNotASharedDurableCas: true,
      issueCommentsAreNotLinearizableClaims: true,
      allTwelveGateClaimsRemainUnauthenticated: true
    }
  );
}
