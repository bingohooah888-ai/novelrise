// REVIEW-ONLY adapter boundary for the existing-Supabase beta Point x10 cutover.
// Deliberately no network, credentials, PostgreSQL driver, GitHub workflow, or
// caller-supplied SQL transport. This module NEVER grants a live operation.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
export const PRODUCTION_REF = 'fiepaguycecrredwrcwx';
export const CUTOVER_SCOPE =
  'reader-reward-beta-point-tenfold-existing-db-staging-v1';
export const SOURCE_SQL_SHA256 =
  '325d1f9514186ba869a17514db0e54339c2fed4d4bd9eb296df2a764cd3dc23e';
export const CUTOVER_RUNTIME_ENABLED = false;
export const WRITER_DOMAINS = Object.freeze([
  'application-api',
  'database-rpc-triggers',
  'privileged-direct-connections',
  'cron-and-scheduled-jobs',
  'queues-retries-and-workers'
]);
export const TIMEOUTS = Object.freeze({
  transactionMs: 90000,
  statementMs: 120000,
  lockMs: 2000
});

const sourceUrl = new URL(
  '../docs/plans/READER-REWARD-POINT10X-EXISTING-DB-ATOMIC-REVIEW-20261106.sql',
  import.meta.url
);
const hex = (value, length) =>
  typeof value === 'string' &&
  new RegExp('^[0-9a-f]{' + length + '}$', 'u').test(value);
const exact = (value, fields) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...fields].sort().join('|');
const fail = (reason) => {
  throw new Error('POINT10X_STAGE35_HOLD:' + reason);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function verifyPinnedCutoverSqlBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || hash(bytes) !== SOURCE_SQL_SHA256)
    fail('SQL_BYTES_NOT_PINNED');
  const sql = bytes.toString('utf8');
  if (Buffer.from(sql, 'utf8').compare(bytes) !== 0)
    fail('SQL_ENCODING_INVALID');
  const required = [
    'BEGIN;',
    'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
    "SET LOCAL transaction_timeout = '90s';",
    "SET LOCAL lock_timeout = '2s';",
    "SET LOCAL statement_timeout = '120s';",
    'IN ACCESS EXCLUSIVE MODE;',
    'NL10_RANGE_OR_REPLAY',
    'NL10_RPC_DRIFT',
    'NL10_PROGRESS_MISMATCH',
    'CREATE SCHEMA point10x_beta;',
    'COMMIT;'
  ];
  if (required.some((item) => !sql.includes(item)))
    fail('SQL_SAFETY_CONTRACT_DRIFT');
  return Object.freeze({
    sqlSha256: SOURCE_SQL_SHA256,
    sqlPath: fileURLToPath(sourceUrl),
    databaseRequired: 'PostgreSQL 17+',
    statementCountNotProofOfSafety: true,
    transaction: Object.freeze({ ...TIMEOUTS }),
    hasRealDbEvidence: false,
    liveAuthorized: false
  });
}

export function compilePinnedCutoverReview() {
  return verifyPinnedCutoverSqlBytes(readFileSync(sourceUrl));
}

function recentIso(value, now) {
  const time = Date.parse(value);
  return (
    typeof value === 'string' &&
    !Number.isNaN(time) &&
    time <= now &&
    now - time <= 24 * 60 * 60 * 1000
  );
}

// An offline checklist is NOT a trusted attestation. A future trusted-main
// verifier, durable single-use admission, authenticated Staging connection and
// proven independent restore/drain must be wired under separate approvals.
export function inspectProposedStagingAdmission(
  evidence,
  { now = Date.now() } = {}
) {
  const compiled = compilePinnedCutoverReview();
  if (
    !exact(evidence, ['approval', 'backup', 'database', 'execution', 'writers'])
  )
    fail('EVIDENCE_FIELDS');
  const { approval, backup, database, execution, writers } = evidence;
  if (
    !exact(approval, [
      'scope',
      'repo',
      'issue',
      'ownerId',
      'commentId',
      'mainSha',
      'sqlSha256',
      'runCount',
      'eventType'
    ]) ||
    approval.scope !== CUTOVER_SCOPE ||
    approval.repo !== 'bingohooah888-ai/novelrise' ||
    approval.issue !== 294 ||
    approval.ownerId !== 317436651 ||
    !Number.isSafeInteger(approval.commentId) ||
    approval.commentId <= 0 ||
    !hex(approval.mainSha, 40) ||
    approval.sqlSha256 !== SOURCE_SQL_SHA256 ||
    approval.runCount !== 1 ||
    approval.eventType !== 'issue_comment.created'
  )
    fail('NEW_OWNER_APPROVAL_SCOPE_REQUIRED');
  if (
    !exact(database, [
      'projectRef',
      'endpointHost',
      'tlsVerified',
      'serverIdentityDigest',
      'postgresMajor',
      'isDedicatedStagingSession'
    ]) ||
    database.projectRef !== STAGING_REF ||
    database.projectRef === PRODUCTION_REF ||
    database.endpointHost !== 'db.' + STAGING_REF + '.supabase.co' ||
    database.tlsVerified !== true ||
    !hex(database.serverIdentityDigest, 64) ||
    database.postgresMajor < 17 ||
    !Number.isInteger(database.postgresMajor) ||
    database.isDedicatedStagingSession !== true
  )
    fail('STAGING_IDENTITY_OR_VERSION_NOT_VERIFIED');
  if (
    !exact(backup, [
      'backupRef',
      'restoredToRef',
      'restoreVerified',
      'integrityDigest',
      'verificationTimestamp',
      'separateFromProduction'
    ]) ||
    typeof backup.backupRef !== 'string' ||
    backup.backupRef.length === 0 ||
    !/^[a-z0-9-]{8,80}$/u.test(backup.restoredToRef || '') ||
    [STAGING_REF, PRODUCTION_REF].includes(backup.restoredToRef) ||
    backup.restoreVerified !== true ||
    backup.separateFromProduction !== true ||
    !hex(backup.integrityDigest, 64) ||
    !recentIso(backup.verificationTimestamp, now)
  )
    fail('INDEPENDENT_RESTORE_NOT_PROVEN');
  if (
    !exact(writers, [
      'coveredDomains',
      'fenceProofDigest',
      'allStopped',
      'inflightTransactions',
      'privilegedBypassBlocked',
      'scheduledJobsPaused',
      'newWritesBlocked',
      'resumePlanVerified',
      'verificationTimestamp'
    ]) ||
    !Array.isArray(writers.coveredDomains) ||
    JSON.stringify(writers.coveredDomains) !== JSON.stringify(WRITER_DOMAINS) ||
    !hex(writers.fenceProofDigest, 64) ||
    writers.allStopped !== true ||
    writers.inflightTransactions !== 0 ||
    writers.privilegedBypassBlocked !== true ||
    writers.scheduledJobsPaused !== true ||
    writers.newWritesBlocked !== true ||
    writers.resumePlanVerified !== true ||
    !recentIso(writers.verificationTimestamp, now)
  )
    fail('WRITERS_NOT_PROVEN_QUIESCENT');
  if (
    !exact(execution, [
      'oneSession',
      'transactionTimeoutMs',
      'statementTimeoutMs',
      'lockTimeoutMs',
      'noAutomaticRetry',
      'commitUnknown'
    ]) ||
    execution.oneSession !== true ||
    execution.transactionTimeoutMs !== TIMEOUTS.transactionMs ||
    execution.statementTimeoutMs !== TIMEOUTS.statementMs ||
    execution.lockTimeoutMs !== TIMEOUTS.lockMs ||
    execution.noAutomaticRetry !== true ||
    execution.commitUnknown !== 'STOP_AND_READ_PRIMARY_MARKER'
  )
    fail('TRANSACTION_BOUNDARY_INVALID');

  return Object.freeze({
    status: 'NO_GO_OFFLINE_EVIDENCE_SHAPE_ONLY',
    sqlSha256: compiled.sqlSha256,
    stagingRef: STAGING_REF,
    requestedOwnerCommentId: approval.commentId,
    realGitHubOwnerVerified: false,
    durableOneUseClaimConsumed: false,
    realDbEndpointAuthenticated: false,
    independentBackupRestoreProven: false,
    writerFenceEnforced: false,
    stagingCommitVerified: false,
    mayConnectDatabase: false,
    mayStopWriters: false,
    mayExecuteSql: false,
    noAutomaticRetry: true
  });
}

// There is no environment switch, boolean or injected callback to enable this.
// Actual admission requires a distinct reviewed live runner and OWNER approval.
export async function executeStagingCutover() {
  fail('NO_TRUSTED_LIVE_EXECUTION_ADAPTER');
}
