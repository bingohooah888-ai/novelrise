// NOVELIGHT beta Scout Point10x: inert PRE-STAGING ACCEPTANCE CONTRACT.
// Never executes approval, SQL, GitHub, CONTROL CAS, backup, or writer fencing.
// A structurally complete packet is only a DESIGN REVIEW artifact, NEVER live authorization.
import {
  makeInertSnapshotManifest,
  SNAPSHOT_PLAN_SCOPE,
  SNAPSHOT_TXN_BOUNDARY,
  REQUIRED_FAIL_CLOSED
} from './scout-point10x-single-snapshot-review.mjs';
import { OWNER_CONTROL_ISSUE } from './scout-point10x-catalog-readonly-review.mjs';
import { STAGING_PROJECT } from './scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from './scout-point10x-durable-fence-model.mjs';
import { SCOUT_POINT_10X_WRITER_CLASSES } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';
import {
  REQUIRED_PRIVILEGED_PATHS,
  SINGLE_USE_CONSTRAINTS
} from './scout-point10x-cas-fencing-handoff-model.mjs';

export const ACCEPTANCE_PROTOCOL =
  'POINT10X_PRESTAGING_ACCEPTANCE_MATRIX_INERT_V1';
export const ACCEPTANCE_PHASES = Object.freeze([
  'OFFLINE_DESIGN',
  'READONLY_ADMISSION',
  'READONLY_ACTUAL_PROOF',
  'CUTOVER_ADMISSION',
  'CUTOVER_ACTUAL_PROOF'
]);
export const EVIDENCE_ORIGINS = Object.freeze([
  'source_review',
  'owner_github',
  'independent_control_primary',
  'dedicated_staging_pg',
  'independent_staging_auditor',
  'writer_data_plane',
  'independent_restore',
  'production_separately_approved'
]);
const frozen = (x) => Object.freeze(x);
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const hex = (s, n) =>
  typeof s === 'string' && new RegExp('^[0-9a-f]{' + n + '}$', 'u').test(s);
const safe = (arr) => frozen([...new Set(arr)]);
const exactKeys = (obj, names) =>
  record(obj) &&
  Object.keys(obj).length === names.length &&
  names.every((k) => Object.hasOwn(obj, k));
const gate = (id, phase, origin, acceptWhen, holdWhen) =>
  frozen({ id, phase, origin, acceptWhen, holdWhen });

// Prerequisites are split by *when evidence can be obtained*.
// No real runtime proof is demanded before it may be collected under new OWNER authorization.
export const ACCEPTANCE_GATES = frozen([
  gate(
    'D01',
    'OFFLINE_DESIGN',
    'source_review',
    'main MASTER and PR refs rechecked',
    'main or MASTER or PR HEAD drifts'
  ),
  gate(
    'D02',
    'OFFLINE_DESIGN',
    'source_review',
    '8+3 SQL byte hashes and 11 digest manifest pinned',
    'source or derived query digest changes'
  ),
  gate(
    'D03',
    'OFFLINE_DESIGN',
    'source_review',
    'threat model and role/permission inventory peer-reviewed',
    'unknown privileged path or unverifiable source'
  ),
  gate(
    'D04',
    'OFFLINE_DESIGN',
    'source_review',
    'separate read-only and mutation approval scopes documented',
    'read-only scope confused with rollback/persist or main merge'
  ),
  gate(
    'D05',
    'OFFLINE_DESIGN',
    'source_review',
    'secret-free evidence retention, incident and cleanup runbook documented',
    'raw rows, credentials or rollback ambiguity in audit'
  ),
  gate(
    'R01',
    'READONLY_ADMISSION',
    'owner_github',
    'fresh owner Issue 294 event, exact new scope, main and head, one run and expiry',
    'old/replayed/edited/foreign approval or no explicit owner action'
  ),
  gate(
    'R02',
    'READONLY_ADMISSION',
    'independent_control_primary',
    'durable one-transaction spent CAS, unique keys, monotone fencing epoch',
    'unknown commit, active owner or stale epoch; never retry'
  ),
  gate(
    'R03',
    'READONLY_ADMISSION',
    'source_review',
    'trusted-main executor reviewed and installed under separate approval',
    'untrusted PR script or local self-reported approval'
  ),
  gate(
    'R04',
    'READONLY_ADMISSION',
    'dedicated_staging_pg',
    'single least-privilege metadata-only read role; deny DML/DDL and impersonation',
    'service_role, SUPERUSER, BYPASSRLS or writable privilege'
  ),
  gate(
    'R05',
    'READONLY_ADMISSION',
    'dedicated_staging_pg',
    'staging target identity independently verified and Production excluded',
    'unknown endpoint, credential scope or cross-project target'
  ),
  gate(
    'R06',
    'READONLY_ADMISSION',
    'source_review',
    'derived 11 SELECT only, one physical connection and rollback plan pinned',
    'separate transactions, altered SQL, COMMIT or automatic reconnect'
  ),
  gate(
    'R07',
    'READONLY_ADMISSION',
    'source_review',
    'permitted sanitized fields, data minimization and audit custody fixed',
    'raw personal data, unreviewed retention or secrets in logs'
  ),
  gate(
    'R08',
    'READONLY_ADMISSION',
    'independent_control_primary',
    'all prior scope and issue ledgers checked before secrets and contact',
    'incomplete pagination, spent approval or shared-domain collision'
  ),
  gate(
    'P01',
    'READONLY_ACTUAL_PROOF',
    'dedicated_staging_pg',
    '11 queries same session/transaction/REPEATABLE READ snapshot with statement digests',
    'missing/extra/select failure or split snapshot'
  ),
  gate(
    'P02',
    'READONLY_ACTUAL_PROOF',
    'dedicated_staging_pg',
    'actual PostgreSQL parse and strictly metadata SELECT validation',
    'static parser mistaken for PostgreSQL enforcement'
  ),
  gate(
    'P03',
    'READONLY_ACTUAL_PROOF',
    'independent_staging_auditor',
    '11 results validated against schema, known RPCs, privileges, ACLs, catalog',
    'unknown role, SECURITY DEFINER, service_role route or result shape'
  ),
  gate(
    'P04',
    'READONLY_ACTUAL_PROOF',
    'dedicated_staging_pg',
    'ROLLBACK ACK and connection close confirmed; partial results discarded',
    'ACK lost, timeout, reconnect or COMMIT'
  ),
  gate(
    'P05',
    'READONLY_ACTUAL_PROOF',
    'independent_staging_auditor',
    'immutable signed and access-restricted sanitized evidence retained',
    'unsigned caller digest or secrets/raw records persisted'
  ),
  gate(
    'P06',
    'READONLY_ACTUAL_PROOF',
    'independent_control_primary',
    'spent/claim epoch read-back and no reuse after unknown acknowledgement',
    'ambiguous CONTROL COMMIT or idempotency not evidenced'
  ),
  gate(
    'C01',
    'CUTOVER_ADMISSION',
    'owner_github',
    'fresh separate atomic mutation scope and explicit owner consent',
    'reuse of read-only, rollback-only or prior run approval'
  ),
  gate(
    'C02',
    'CUTOVER_ADMISSION',
    'independent_control_primary',
    'linearizable shared-domain CAS with permanent spent tombstones',
    'GitHub comment read/append or Actions concurrency mistaken for CAS'
  ),
  gate(
    'C03',
    'CUTOVER_ADMISSION',
    'writer_data_plane',
    'nine writer classes and five privileged paths denied at DB level',
    'old RPC, service_role, trigger, queue or bypass remains'
  ),
  gate(
    'C04',
    'CUTOVER_ADMISSION',
    'writer_data_plane',
    'fence epoch enforced across old/new workflows, pending/inflight/outbox drained',
    'old token accepted or unacknowledged writer'
  ),
  gate(
    'C05',
    'CUTOVER_ADMISSION',
    'independent_restore',
    'full independent backup restore verified in isolated DB',
    'dump-only, same-instance restore or no row digest parity'
  ),
  gate(
    'C06',
    'CUTOVER_ADMISSION',
    'independent_staging_auditor',
    'locked source watermark, function ACL/RLS/trigger and full-row digests pinned',
    'table or event/reversal state drift'
  ),
  gate(
    'C07',
    'CUTOVER_ADMISSION',
    'source_review',
    'private marker, 5-to-50 RPC and ledgers in one atomic SQL design',
    'partial cutover or old RPC not updated'
  ),
  gate(
    'C08',
    'CUTOVER_ADMISSION',
    'source_review',
    'written forward-repair and commit-unknown recovery without stale restore',
    'ambiguous commit automatically retried or old backup overwrites new points'
  ),
  gate(
    'C09',
    'CUTOVER_ADMISSION',
    'production_separately_approved',
    'Production is isolated behind separate future approval',
    'Staging approval interpreted as Production permission'
  ),
  gate(
    'Q01',
    'CUTOVER_ACTUAL_PROOF',
    'writer_data_plane',
    'all nine writers and five privileged routes really fenced and drained',
    'old token or privileged bypass still writes'
  ),
  gate(
    'Q02',
    'CUTOVER_ACTUAL_PROOF',
    'independent_restore',
    'independent restore validated counts, full rows, ACL/RLS/trigger, event history',
    'partial/missing/newer data or restore not independently proven'
  ),
  gate(
    'Q03',
    'CUTOVER_ACTUAL_PROOF',
    'dedicated_staging_pg',
    'single marker/RPC/Point/XP/Badge/Operator transaction and conservation',
    'partial COMMIT, double award, lost cancellation or incorrect unit'
  ),
  gate(
    'Q04',
    'CUTOVER_ACTUAL_PROOF',
    'independent_staging_auditor',
    'postcommit reconciliation, idempotency and run-specific evidence sealed',
    'unknown COMMIT or mismatched row digests'
  ),
  gate(
    'Q05',
    'CUTOVER_ACTUAL_PROOF',
    'independent_control_primary',
    'durable spent and epoch confirmed after interruption without replay',
    'reused owner comment or fence release on uncertainty'
  ),
  gate(
    'Q06',
    'CUTOVER_ACTUAL_PROOF',
    'production_separately_approved',
    'distinct owner decision for Production after real Staging proof',
    'CI success or Staging scope treated as deploy approval'
  )
]);
export const AUDIT_SEQUENCE = frozen([
  'freeze_references_and_review_design_without_external_execution',
  'peer_review_source_only_acceptance_matrix_and_unknowns',
  'design_and_review_trusted_main_readonly_executor_under_separate_approval',
  'obtain_fresh_owner_authorization_only_when_live_readonly_run_is_requested',
  'trusted_executor_checks_owner_control_staging_and_metadata_only_role',
  'perform_one_approved_readonly_snapshot_and_rollback_then_seal_evidence',
  'review_actual_catalog_and_privileged_paths_without_inferring_writer_fence',
  'independent_cutover_security_backup_and_recovery_review',
  'obtain_separate_new_owner_mutation_authorization_only_after_gate_review',
  'run_future_staging_cutover_tests_under_separate_guarded_scope',
  'do_not_proceed_to_production_without_a_distinct_owner_decision'
]);
export const ACCEPTANCE_PHASE_COUNTS = frozen(
  ACCEPTANCE_PHASES.map((phase) =>
    frozen({
      phase,
      count: ACCEPTANCE_GATES.filter((g) => g.phase === phase).length
    })
  )
);
const keys = frozen(['protocol', 'context', 'rows', 'guardrails']);
const contextKeys = frozen([
  'repository',
  'mainSha',
  'masterBlob',
  'prNumber',
  'prHead',
  'sqlPrNumber',
  'sqlPrHead',
  'issueNumber',
  'stagingRef',
  'ownerScope',
  'operation',
  'planDigest',
  'baseSqlSha',
  'addendumSqlSha',
  'statementCount',
  'mutationDomain',
  'writerClassCount',
  'privilegedPathCount',
  'ownerScopeState'
]);
const guardKeys = frozen([
  'connectedToDb',
  'sqlExecuted',
  'ownerEventIssued',
  'ownerEventConsumed',
  'dockerStarted',
  'stagingModified',
  'productionModified',
  'mainMerged',
  'deployed',
  'allowCredentials',
  'pretendLiveProof'
]);
const rowKeys = frozen([
  'id',
  'phase',
  'origin',
  'evidenceState',
  'artifactRef'
]);
const baseline = () => {
  const m = makeInertSnapshotManifest();
  return {
    repository: 'bingohooah888-ai/novelrise',
    mainSha: 'a'.repeat(40),
    masterBlob: '91d11fa367b7de64990b13397b13d4bb6e3c0230',
    prNumber: 2762,
    prHead: 'b'.repeat(40),
    sqlPrNumber: 2763,
    sqlPrHead: 'c'.repeat(40),
    issueNumber: OWNER_CONTROL_ISSUE,
    stagingRef: STAGING_PROJECT,
    ownerScope: SNAPSHOT_PLAN_SCOPE,
    operation: 'read-catalog-11-same-snapshot',
    planDigest: m.planDigest,
    baseSqlSha: SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.base,
    addendumSqlSha: SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.addendum,
    statementCount: m.sectionCount,
    mutationDomain: MUTATION_DOMAIN,
    writerClassCount: SCOUT_POINT_10X_WRITER_CLASSES.length,
    privilegedPathCount: REQUIRED_PRIVILEGED_PATHS.length,
    ownerScopeState: 'NOT_REGISTERED_NOT_APPROVED'
  };
};
export function makeInertAcceptancePacket() {
  return {
    protocol: ACCEPTANCE_PROTOCOL,
    context: baseline(),
    rows: ACCEPTANCE_GATES.map((g) => ({
      id: g.id,
      phase: g.phase,
      origin: g.origin,
      evidenceState: 'NOT_OBSERVED',
      artifactRef: null
    })),
    guardrails: Object.fromEntries(guardKeys.map((k) => [k, false]))
  };
}
export function reviewInertAcceptancePacket({
  packet,
  expectedMainSha,
  expectedPrHead,
  expectedSqlPrHead
} = {}) {
  const failures = [];
  if (!record(packet) || packet.protocol !== ACCEPTANCE_PROTOCOL)
    return conclude(['ACCEPTANCE_PACKET_PROTOCOL_REQUIRED']);
  if (!exactKeys(packet, keys)) failures.push('UNKNOWN_PACKET_FIELDS');
  const c = packet.context,
    b = baseline();
  if (!exactKeys(c, contextKeys))
    failures.push('CONTEXT_INCOMPLETE_OR_UNEXPECTED');
  if (
    !hex(expectedMainSha, 40) ||
    !hex(expectedPrHead, 40) ||
    !hex(expectedSqlPrHead, 40)
  )
    failures.push('EXPECTED_HEADS_ARE_NOT_EXACT_SHA');
  if (
    c?.mainSha !== expectedMainSha ||
    c?.prHead !== expectedPrHead ||
    c?.sqlPrHead !== expectedSqlPrHead
  )
    failures.push('FRESH_MAIN_OR_PR_HEAD_DRIFT');
  for (const [key, value] of Object.entries(b)) {
    if (['mainSha', 'prHead', 'sqlPrHead'].includes(key)) continue;
    if (c?.[key] !== value) failures.push('PINNED_CONTEXT_DRIFT');
  }
  if (
    !Array.isArray(packet.rows) ||
    packet.rows.length !== ACCEPTANCE_GATES.length
  )
    failures.push('REQUIRED_GATE_COUNT_MISMATCH');
  if (Array.isArray(packet.rows))
    for (
      let i = 0;
      i < Math.max(packet.rows.length, ACCEPTANCE_GATES.length);
      i++
    ) {
      const row = packet.rows[i],
        g = ACCEPTANCE_GATES[i];
      if (
        !g ||
        !exactKeys(row, rowKeys) ||
        row.id !== g.id ||
        row.phase !== g.phase ||
        row.origin !== g.origin
      )
        failures.push('GATE_ORDER_OR_TYPE_MISMATCH');
      if (row?.evidenceState !== 'NOT_OBSERVED' || row?.artifactRef !== null)
        failures.push('SELF_ASSERTED_EVIDENCE_CANNOT_PROVE_LIVE_READINESS');
    }
  if (
    !exactKeys(packet.guardrails, guardKeys) ||
    guardKeys.some((k) => packet.guardrails?.[k] !== false)
  )
    failures.push('EXTERNAL_ACTION_OR_FALSE_PROOF_PROHIBITED');
  return conclude(failures);
}
function conclude(failures) {
  const problems = safe(failures);
  return frozen({
    status: problems.length
      ? 'HOLD_INERT_ACCEPTANCE_CONTRACT'
      : 'DESIGN_MATRIX_COMPLETE_NO_GO',
    decision: 'NO_GO',
    designShapeValid: problems.length === 0,
    reasons: safe([
      ...REQUIRED_FAIL_CLOSED,
      'OWNER_READONLY_SCOPE_NOT_REGISTERED_NOT_APPROVED',
      'ALL_LIVE_EVIDENCE_STILL_UNOBSERVED',
      ...problems
    ]),
    gateCount: ACCEPTANCE_GATES.length,
    phases: ACCEPTANCE_PHASE_COUNTS,
    readyForOwnerReviewOnly: problems.length === 0,
    readyForReadOnlyExecution: false,
    readyForCutover: false,
    incompleteLiveEvidenceCount: ACCEPTANCE_GATES.length,
    allInputIsUntrusted: true,
    sourceOnly: true,
    actualOwnerAuthenticated: false,
    actualControlCasVerified: false,
    actualWriterFenced: false,
    actualBackupRestored: false,
    actualStagingSnapshotProven: false,
    realDatabaseConnections: 0,
    mayRunSql: false,
    mayConnectDb: false,
    mayUseDocker: false,
    mayIssueApproval: false,
    mayClaimApproval: false,
    mayChangeStaging: false,
    mayChangeProduction: false,
    mayMergeMain: false,
    mayDeploy: false,
    mayRetryAfterUnknownCommit: false
  });
}
