// NOVELIGHT βScout Point10x: INERT single-snapshot execution plan and synthetic trace.
// This module must never execute SQL, connect to a database, or consume OWNER approval.
import { createHash } from 'node:crypto';
import {
  readPinnedCatalogSql,
  PINNED_CATALOG_SQL_SHA256,
  REQUIRED_CATALOG_SECTIONS,
  PROPOSED_CATALOG_SCOPE,
  OWNER_CONTROL_ISSUE
} from './scout-point10x-catalog-readonly-review.mjs';
import {
  readAddendumSql,
  ADDENDUM_SQL_SHA256,
  ADDENDUM_IDS
} from './scout-point10x-privileged-catalog-addendum.mjs';
import {
  PROPOSED_BUNDLE_SCOPE,
  computeProposedBundleDigest,
  reviewTrustedMainCatalogBundleContract,
  BUNDLE_SQL_HASHES,
  BUNDLE_REVIEW_BLOCKERS
} from './scout-point10x-catalog-evidence-union.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from './scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from './scout-point10x-durable-fence-model.mjs';

const hash = (x) => createHash('sha256').update(x).digest('hex');
const rec = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const unique = (x) => Object.freeze([...new Set(x)]);
const frozen = (x) => Object.freeze(x);
const hex40 = (x) => typeof x === 'string' && /^[a-f0-9]{40}$/u.test(x);
const hex64 = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/u.test(x);
export const SINGLE_SNAPSHOT_IDS = Object.freeze([
  ...REQUIRED_CATALOG_SECTIONS,
  ...ADDENDUM_IDS
]);
export const SNAPSHOT_PLAN_SCOPE =
  'reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly';
export const PLAN_SEQUENCE = Object.freeze([
  'trusted_owner_authenticate_issue294_target_sha_scope_expiry',
  'durable_control_cas_shared_mutation_domain_one_shot_spent',
  'establish_independent_readonly_staging_project_connection',
  'pin_source_sql_bytes_and_review_plan_digest',
  'begin_one_connection_repeatable_read_read_only_transaction',
  'capture_same_session_transaction_snapshot_evidence',
  'execute_eight_base_statements_in_pinned_order',
  'execute_three_addendum_statements_in_pinned_order',
  'validate_eleven_section_outputs_cardinality_schema_digests',
  'rollback_same_readonly_transaction_and_close_connection',
  'immutable_sanitized_evidence_then_no_staging_go_inference',
  'hold_and_authoritative_readback_on_uncertain_control_commit'
]);
export const REQUIRED_FAIL_CLOSED = Object.freeze([
  'REAL_TRUSTED_MAIN_EXECUTOR_NOT_INSTALLED',
  'NEW_OWNER_SINGLE_SNAPSHOT_SCOPE_NOT_APPROVED',
  'CONTROL_POSTGRES_ATOMIC_SPENT_CAS_UNPROVEN',
  'SHARED_MUTATION_DOMAIN_AND_FENCING_NOT_LIVE',
  'DEDICATED_READONLY_STAGING_CONNECTION_UNPROVEN',
  'SINGLE_REAL_PG_SNAPSHOT_NOT_CAPTURED',
  'ACTUAL_SERVICE_ROLE_WRITER_FENCE_UNPROVEN',
  'ACTUAL_BACKUP_RESTORE_AND_QUEUE_DRAIN_UNPROVEN'
]);
export const SNAPSHOT_TXN_BOUNDARY = Object.freeze({
  connectionCount: 1,
  transactionBegin:
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
  termination: 'ROLLBACK',
  permittedStatementCount: 11,
  transactionControlFromSourceFilesMustBeOmittedInDerivative: true,
  sourceSQLMayBeChanged: false,
  originalSqlDigests: frozen({
    base: PINNED_CATALOG_SQL_SHA256,
    addendum: ADDENDUM_SQL_SHA256
  }),
  singleSessionAndTransactionRequired: true,
  executionEnabled: false
});
const result = (status, blockers, details = {}) =>
  frozen({
    status,
    blockers: unique(blockers),
    ...details,
    reviewOnly: true,
    sourceTrust: 'UNTRUSTED_OFFLINE_FIXTURE',
    authenticatedOwner: false,
    actualControlClaimed: false,
    actualSpentConsumed: false,
    singleRealSnapshotVerified: false,
    realSqlExecuted: false,
    actualCatalogCompared: false,
    realPrivilegedWriterFenced: false,
    mayConnectDb: false,
    mayRunSql: false,
    mayWriteDb: false,
    mayClaimOwner: false,
    mayUseDocker: false,
    mayRunStaging: false,
    mayChangeProduction: false,
    mayMergeMain: false,
    mayDeploy: false
  });
const markers = (s) => [
  ...s.matchAll(/^-- (NL-(?:CATALOG|GAP)-\d{2}):[^\r\n]*\r?\n/gmu)
];
function inspectSqlSource(source, expectedIds, expectedSha, prefix, errors) {
  if (typeof source !== 'string') {
    errors.push(prefix + '_SOURCE_NOT_TEXT');
    return [];
  }
  if (hash(source) !== expectedSha)
    errors.push(prefix + '_SQL_BYTES_HASH_MISMATCH');
  if (
    (
      source.match(
        /^\s*BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\s*$/gmu
      ) || []
    ).length !== 1
  )
    errors.push(prefix + '_READONLY_BEGIN_INVALID');
  if ((source.match(/^\s*ROLLBACK;\s*$/gmu) || []).length !== 1)
    errors.push(prefix + '_ROLLBACK_INVALID');
  if (
    /\b(?:COMMIT|SAVEPOINT|RELEASE|SET\s+ROLE)\b/iu.test(
      source.replace(/--[^\r\n]*/gu, ' ')
    )
  )
    errors.push(prefix + '_UNEXPECTED_TRANSACTION_CONTROL');
  const found = markers(source);
  if (found.length !== expectedIds.length)
    errors.push(prefix + '_SECTION_COUNT_INVALID');
  const statements = [];
  for (let i = 0; i < found.length; i++) {
    const m = found[i],
      id = m[1];
    if (id !== expectedIds[i]) errors.push(prefix + '_SECTION_ORDER_INVALID');
    let fragment = source
      .slice(
        m.index + m[0].length,
        i + 1 < found.length
          ? found[i + 1].index
          : source.lastIndexOf('ROLLBACK;')
      )
      .trim();
    if (i === found.length - 1) {
      fragment = fragment.trim();
    }
    const normalized = fragment
      .replace(/^\s*(?:--[^\r\n]*(?:\r?\n|$))+/gu, '')
      .trim();
    if (!/^(SELECT|WITH)\s/iu.test(normalized))
      errors.push(prefix + '_NON_SELECT_FRAGMENT');
    if (!fragment.endsWith(';') || (fragment.match(/;/gu) || []).length !== 1)
      errors.push(prefix + '_FRAGMENT_SEMICOLON_INVALID');
    statements.push(
      frozen({
        id,
        order: i + 1,
        source: prefix,
        queryDigest: hash(fragment),
        containsOnlyOneTopLevelSelectUnderExactSourcePin:
          hash(source) === expectedSha &&
          /^(SELECT|WITH)\s/iu.test(normalized) &&
          fragment.endsWith(';') &&
          (fragment.match(/;/gu) || []).length === 1
      })
    );
  }
  return statements;
}
export function makeInertSnapshotManifest({
  baseSql = readPinnedCatalogSql(),
  addendumSql = readAddendumSql().toString('utf8')
} = {}) {
  const errors = [...REQUIRED_FAIL_CLOSED];
  const base = inspectSqlSource(
    baseSql,
    REQUIRED_CATALOG_SECTIONS,
    PINNED_CATALOG_SQL_SHA256,
    'BASE',
    errors
  );
  const addon = inspectSqlSource(
    addendumSql,
    ADDENDUM_IDS,
    ADDENDUM_SQL_SHA256,
    'ADDENDUM',
    errors
  );
  const all = [...base, ...addon];
  if (
    all.length !== 11 ||
    !all.every((item, i) => item.id === SINGLE_SNAPSHOT_IDS[i])
  )
    errors.push('ELEVEN_PINNED_SELECTS_IN_ORDER_REQUIRED');
  const statements = frozen(all.map((s, i) => frozen({ ...s, order: i + 1 })));
  const digest = hash(
    'NOVELIGHT-INERT-SNAPSHOT-PLAN-V1\n' +
      PINNED_CATALOG_SQL_SHA256 +
      '\n' +
      ADDENDUM_SQL_SHA256 +
      '\n' +
      all.map((s) => s.id + '|' + s.queryDigest).join('\n') +
      '\n'
  );
  return result('NO_GO_INERT_SNAPSHOT_PLAN_ONLY', errors, {
    planDigest: digest,
    sourceSqlDigests: SNAPSHOT_TXN_BOUNDARY.originalSqlDigests,
    statements,
    sectionCount: all.length,
    planScope: SNAPSHOT_PLAN_SCOPE,
    transactionBoundary: SNAPSHOT_TXN_BOUNDARY,
    sourceBytesChanged: errors.some((code) =>
      code.endsWith('_SQL_BYTES_HASH_MISMATCH')
    ),
    staticFragmentAnalysisOnly: true,
    actualPostgresParserValidation: false
  });
}
export function reviewInertSnapshotTrace({
  manifest = makeInertSnapshotManifest(),
  trace
} = {}) {
  const errors = [...REQUIRED_FAIL_CLOSED];
  if (!rec(trace))
    return result('HOLD_INVALID_SYNTHETIC_TRACE', [
      ...errors,
      'TRACE_RECORD_REQUIRED'
    ]);
  if (!Array.isArray(trace.events) || trace.events.length !== 13)
    errors.push('ONE_BEGIN_ELEVEN_SELECTS_ONE_ROLLBACK_REQUIRED');
  if (trace.planDigest !== manifest.planDigest)
    errors.push('TRACE_PLAN_DIGEST_MISMATCH');
  if (
    trace.sourceSqlDigests?.base !== PINNED_CATALOG_SQL_SHA256 ||
    trace.sourceSqlDigests?.addendum !== ADDENDUM_SQL_SHA256
  )
    errors.push('TRACE_BOTH_SOURCE_DIGESTS_REQUIRED');
  const ev = Array.isArray(trace.events) ? trace.events : [];
  const begin = ev[0],
    end = ev[12];
  if (
    begin?.action !== 'BEGIN_READ_ONLY_REPEATABLE_READ' ||
    end?.action !== 'ROLLBACK'
  )
    errors.push('BEGIN_OR_ROLLBACK_NOT_ENFORCED');
  if (
    !begin?.sessionToken ||
    !begin?.transactionToken ||
    !begin?.snapshotToken ||
    !begin?.sessionToken.startsWith('fixture-')
  )
    errors.push('SYNTHETIC_TRANSACTION_CONTEXT_MISSING');
  if (begin?.dbRef !== STAGING_PROJECT || end?.dbRef !== STAGING_PROJECT)
    errors.push('STAGING_REF_NOT_FIXED');
  if (begin?.readOnly !== true || begin?.isolation !== 'REPEATABLE READ')
    errors.push('READONLY_REPEATABLE_READ_NOT_ESTABLISHED');
  if (end?.rollbackAck !== 'received')
    errors.push('ROLLBACK_ACK_MISSING_OR_UNCERTAIN');
  if (ev.length === 13) {
    for (let i = 0; i < 11; i++) {
      const e = ev[i + 1];
      if (
        e?.action !== 'SELECT_METADATA' ||
        e?.sectionId !== SINGLE_SNAPSHOT_IDS[i]
      )
        errors.push('SELECT_SEQUENCE_OR_SECTION_MISMATCH');
      if (
        e?.status !== 'ok' ||
        !Number.isSafeInteger(e.rowCount) ||
        e.rowCount < 0 ||
        !hex64(e.resultDigest)
      )
        errors.push('QUERY_RESULT_INCOMPLETE_OR_FAILED');
    }
  }
  for (const e of ev) {
    if (!rec(e)) {
      errors.push('MALFORMED_TRACE_EVENT');
      continue;
    }
    if (
      e.sessionToken !== begin?.sessionToken ||
      e.transactionToken !== begin?.transactionToken ||
      e.snapshotToken !== begin?.snapshotToken
    )
      errors.push('TRACE_SPLIT_CONNECTION_TRANSACTION_OR_SNAPSHOT');
    if (e.dbRef !== STAGING_PROJECT || e.dbRef === PRODUCTION_PROJECT)
      errors.push('TRACE_WRONG_DB_TARGET');
    if (e.action === 'COMMIT' || e.action === 'DML' || e.action === 'DDL')
      errors.push('TRACE_FORBIDDEN_MUTATION_OR_COMMIT');
  }
  return result('NO_GO_SYNTHETIC_SNAPSHOT_TRACE_ONLY', errors, {
    completeSyntheticSectionCount: ev
      .slice(1, 12)
      .filter((e) => e?.action === 'SELECT_METADATA' && e.status === 'ok')
      .length,
    invariantPassInFixture: errors.length === REQUIRED_FAIL_CLOSED.length,
    noRealSameSnapshotProof: true
  });
}
export function makeGoodSyntheticTrace(manifest = makeInertSnapshotManifest()) {
  const common = frozen({
    sessionToken: 'fixture-one-connection',
    transactionToken: 'fixture-one-transaction',
    snapshotToken: 'fixture-one-snapshot',
    dbRef: STAGING_PROJECT
  });
  return frozen({
    planDigest: manifest.planDigest,
    sourceSqlDigests: SNAPSHOT_TXN_BOUNDARY.originalSqlDigests,
    events: frozen([
      frozen({
        ...common,
        action: 'BEGIN_READ_ONLY_REPEATABLE_READ',
        readOnly: true,
        isolation: 'REPEATABLE READ'
      }),
      ...SINGLE_SNAPSHOT_IDS.map((id) =>
        frozen({
          ...common,
          action: 'SELECT_METADATA',
          sectionId: id,
          status: 'ok',
          rowCount: 1,
          resultDigest: 'a'.repeat(64)
        })
      ),
      frozen({ ...common, action: 'ROLLBACK', rollbackAck: 'received' })
    ])
  });
}
export function reviewSnapshotOwnerClaimContract({
  request,
  manifest = makeInertSnapshotManifest()
} = {}) {
  const errors = [...REQUIRED_FAIL_CLOSED];
  if (!rec(request))
    return result('HOLD_OWNER_REQUEST_MISSING', [
      ...errors,
      'EXACT_OWNER_REQUEST_REQUIRED'
    ]);
  if (
    request.scope !== SNAPSHOT_PLAN_SCOPE ||
    request.scope === PROPOSED_CATALOG_SCOPE ||
    request.scope === PROPOSED_BUNDLE_SCOPE
  )
    errors.push('FRESH_SNAPSHOT_ONLY_SCOPE_REQUIRED');
  if (request.operation !== 'read-catalog-11-same-snapshot')
    errors.push('READ_ONLY_SNAPSHOT_OPERATION_REQUIRED');
  if (request.issueNumber !== OWNER_CONTROL_ISSUE)
    errors.push('OWNER_ISSUE_294_REQUIRED');
  if (
    request.stagingRef !== STAGING_PROJECT ||
    request.stagingRef === PRODUCTION_PROJECT
  )
    errors.push('STAGING_ONLY_IDENTITY_REQUIRED');
  if (!hex40(request.mainSha) || !hex40(request.headSha))
    errors.push('OWNER_EXACT_MAIN_AND_PR_HEAD_REQUIRED');
  if (request.planDigest !== manifest.planDigest || !hex64(request.planDigest))
    errors.push('PINNED_MANIFEST_DIGEST_REQUIRED');
  if (
    request.originalSqlDigests?.base !== BUNDLE_SQL_HASHES.base ||
    request.originalSqlDigests?.addendum !== BUNDLE_SQL_HASHES.addendum
  )
    errors.push('BOTH_ORIGINAL_SQL_DIGESTS_REQUIRED');
  if (!Number.isSafeInteger(request.commentId) || request.commentId <= 0)
    errors.push('UNIQUE_NEW_OWNER_COMMENT_REQUIRED');
  if (
    request.ownerProof !== undefined ||
    request.approved !== undefined ||
    request.claimed !== undefined ||
    request.liveVerified !== undefined
  )
    errors.push('CALLER_OWNER_AUTHORITY_SELF_ASSERTION_REJECTED');
  return result('HOLD_SNAPSHOT_OWNER_GATE_NOT_INSTALLED', errors, {
    proposedScope: SNAPSHOT_PLAN_SCOPE,
    requiredSteps: PLAN_SEQUENCE,
    sharedMutationDomain: MUTATION_DOMAIN,
    spentControlDatabaseImplemented: false,
    trustedMainExecutorInstalled: false,
    issuerAuthenticated: false,
    canonicallyPinnedTwoSqlAndPlanDigest: true,
    previousOwnerScopeReusable: false,
    existingBundleScopePermitted: false,
    notAnOwnerApproval: true
  });
}
export function reviewHypotheticalSpentTrace({
  state,
  commentId,
  expectedVersion,
  expectedEpoch,
  commitAck = 'received'
} = {}) {
  const errors = [...REQUIRED_FAIL_CLOSED];
  if (
    !rec(state) ||
    state.domain !== MUTATION_DOMAIN ||
    !Number.isSafeInteger(state.version) ||
    state.version < 0 ||
    !Number.isSafeInteger(state.epoch) ||
    state.epoch < 0 ||
    !Array.isArray(state.spent) ||
    !rec(state)
  )
    return result('HOLD_INVALID_SPENT_FIXTURE', [
      ...errors,
      'INVALID_DURABLE_CAS_FIXTURE'
    ]);
  if (!Number.isSafeInteger(commentId) || commentId <= 0)
    errors.push('COMMENT_ID_REQUIRED');
  if (state.version !== expectedVersion || state.epoch !== expectedEpoch)
    errors.push('STALE_CAS_VERSION_OR_FENCE_EPOCH');
  if (state.spent.includes(commentId)) errors.push('COMMENT_ALREADY_SPENT');
  if (state.active !== null) errors.push('MUTATION_DOMAIN_NOT_FREE');
  if (state.commitUnknown === true)
    errors.push('UNCERTAIN_COMMIT_READBACK_REQUIRED');
  if (!['received', 'lost', 'unknown'].includes(commitAck))
    errors.push('COMMIT_ACK_UNKNOWN_FORMAT');
  if (errors.length > REQUIRED_FAIL_CLOSED.length)
    return result('HOLD_SPENT_FIXTURE_CONFLICT', errors, {
      hypotheticalOnly: true
    });
  const next = frozen({
    domain: MUTATION_DOMAIN,
    version: state.version + 1,
    epoch: state.epoch + 1,
    spent: frozen([...state.spent, commentId]),
    active: commentId,
    commitUnknown: commitAck !== 'received'
  });
  return result(
    commitAck === 'received'
      ? 'MODEL_SPENT_NOT_REAL'
      : 'HOLD_MODEL_LOST_COMMIT_ACK',
    errors,
    {
      hypotheticalOnly: true,
      modelState: next,
      noRetry: true,
      noRelease: true
    }
  );
}
export function newHypotheticalSpentState() {
  return frozen({
    domain: MUTATION_DOMAIN,
    version: 0,
    epoch: 0,
    spent: frozen([]),
    active: null,
    commitUnknown: false
  });
}
