import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CUTOVER_RUNTIME_ENABLED,
  CUTOVER_SCOPE,
  PRODUCTION_REF,
  SOURCE_SQL_SHA256,
  STAGING_REF,
  TIMEOUTS,
  WRITER_DOMAINS,
  compilePinnedCutoverReview,
  executeStagingCutover,
  inspectProposedStagingAdmission,
  verifyPinnedCutoverSqlBytes
} from '../scripts/scout-point10x-staging-cutover-adapter.mjs';

const digest = 'a'.repeat(64);
function syntheticEvidence(now = Date.now()) {
  const time = new Date(now).toISOString();
  return {
    approval: {
      scope: CUTOVER_SCOPE,
      repo: 'bingohooah888-ai/novelrise',
      issue: 294,
      ownerId: 317436651,
      commentId: 999999999,
      mainSha: 'b'.repeat(40),
      sqlSha256: SOURCE_SQL_SHA256,
      runCount: 1,
      eventType: 'issue_comment.created'
    },
    database: {
      projectRef: STAGING_REF,
      endpointHost: 'db.' + STAGING_REF + '.supabase.co',
      tlsVerified: true,
      serverIdentityDigest: digest,
      postgresMajor: 17,
      isDedicatedStagingSession: true
    },
    backup: {
      backupRef: 'synthetic-offline-backup',
      restoredToRef: 'synthetic-restore-only',
      restoreVerified: true,
      integrityDigest: digest,
      verificationTimestamp: time,
      separateFromProduction: true
    },
    writers: {
      coveredDomains: [...WRITER_DOMAINS],
      fenceProofDigest: digest,
      allStopped: true,
      inflightTransactions: 0,
      privilegedBypassBlocked: true,
      scheduledJobsPaused: true,
      newWritesBlocked: true,
      resumePlanVerified: true,
      verificationTimestamp: time
    },
    execution: {
      oneSession: true,
      transactionTimeoutMs: TIMEOUTS.transactionMs,
      statementTimeoutMs: TIMEOUTS.statementMs,
      lockTimeoutMs: TIMEOUTS.lockMs,
      noAutomaticRetry: true,
      commitUnknown: 'STOP_AND_READ_PRIMARY_MARKER'
    }
  };
}

test('approved SQL is byte-pinned; no live capability', () => {
  const batch = compilePinnedCutoverReview();
  assert.equal(batch.sqlSha256, SOURCE_SQL_SHA256);
  assert.equal(batch.databaseRequired, 'PostgreSQL 17+');
  assert.equal(batch.transaction.transactionMs, 90000);
  assert.equal(batch.transaction.lockMs, 2000);
  assert.equal(batch.liveAuthorized, false);
  assert.equal(CUTOVER_RUNTIME_ENABLED, false);
  const source = readFileSync(batch.sqlPath);
  assert.equal(
    verifyPinnedCutoverSqlBytes(source).sqlSha256,
    SOURCE_SQL_SHA256
  );
  assert.throws(
    () =>
      verifyPinnedCutoverSqlBytes(
        Buffer.concat([source, Buffer.from(' --tampered')])
      ),
    /SQL_BYTES_NOT_PINNED/
  );
  assert.throws(
    () => verifyPinnedCutoverSqlBytes('SELECT 1'),
    /SQL_BYTES_NOT_PINNED/
  );
});

test('even perfectly shaped synthetic proof can never authorize a live switch', () => {
  const proof = inspectProposedStagingAdmission(syntheticEvidence());
  assert.equal(proof.status, 'NO_GO_OFFLINE_EVIDENCE_SHAPE_ONLY');
  assert.equal(proof.realGitHubOwnerVerified, false);
  assert.equal(proof.durableOneUseClaimConsumed, false);
  assert.equal(proof.realDbEndpointAuthenticated, false);
  assert.equal(proof.writerFenceEnforced, false);
  assert.equal(proof.mayConnectDatabase, false);
  assert.equal(proof.mayExecuteSql, false);
  assert.equal(proof.noAutomaticRetry, true);
});

test('scope, owner, event and one-use bounds reject different approvals', () => {
  for (const [key, value] of [
    [
      'scope',
      'reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly'
    ],
    ['ownerId', 111],
    ['issue', 10],
    ['runCount', 2],
    ['commentId', 0],
    ['eventType', 'workflow_dispatch'],
    ['mainSha', 'not-a-sha'],
    ['sqlSha256', digest]
  ]) {
    const evidence = syntheticEvidence();
    evidence.approval[key] = value;
    assert.throws(
      () => inspectProposedStagingAdmission(evidence),
      /NEW_OWNER_APPROVAL_SCOPE_REQUIRED/,
      key
    );
  }
});

test('wrong DB or Production reference is held', () => {
  for (const [key, value] of [
    ['projectRef', PRODUCTION_REF],
    ['endpointHost', 'db.' + PRODUCTION_REF + '.supabase.co'],
    ['tlsVerified', false],
    ['serverIdentityDigest', 'bad'],
    ['postgresMajor', 16],
    ['isDedicatedStagingSession', false]
  ]) {
    const evidence = syntheticEvidence();
    evidence.database[key] = value;
    assert.throws(
      () => inspectProposedStagingAdmission(evidence),
      /STAGING_IDENTITY_OR_VERSION_NOT_VERIFIED/,
      key
    );
  }
});

test('backup without a separate fresh restore remains held', () => {
  for (const [key, value] of [
    ['restoredToRef', PRODUCTION_REF],
    ['restoredToRef', STAGING_REF],
    ['restoreVerified', false],
    ['separateFromProduction', false],
    ['integrityDigest', 'unverified'],
    ['verificationTimestamp', '2024-01-01T00:00:00.000Z'],
    ['backupRef', '']
  ]) {
    const evidence = syntheticEvidence();
    evidence.backup[key] = value;
    assert.throws(
      () => inspectProposedStagingAdmission(evidence),
      /INDEPENDENT_RESTORE_NOT_PROVEN/,
      key
    );
  }
});

test('all writer paths must be quiescent with a resume plan', () => {
  for (const [key, value] of [
    ['coveredDomains', WRITER_DOMAINS.slice(1)],
    ['fenceProofDigest', 'broken'],
    ['allStopped', false],
    ['inflightTransactions', 1],
    ['privilegedBypassBlocked', false],
    ['scheduledJobsPaused', false],
    ['newWritesBlocked', false],
    ['resumePlanVerified', false],
    ['verificationTimestamp', '2023-01-01T00:00:00Z']
  ]) {
    const evidence = syntheticEvidence();
    evidence.writers[key] = value;
    assert.throws(
      () => inspectProposedStagingAdmission(evidence),
      /WRITERS_NOT_PROVEN_QUIESCENT/,
      key
    );
  }
});

test('total transaction deadline, per-statement and lock limits remain pinned', () => {
  for (const [key, value] of [
    ['transactionTimeoutMs', 0],
    ['statementTimeoutMs', 0],
    ['lockTimeoutMs', 30000],
    ['oneSession', false],
    ['noAutomaticRetry', false],
    ['commitUnknown', 'RETRY']
  ]) {
    const evidence = syntheticEvidence();
    evidence.execution[key] = value;
    assert.throws(
      () => inspectProposedStagingAdmission(evidence),
      /TRANSACTION_BOUNDARY_INVALID/,
      key
    );
  }
});

test('unexpected evidence fields fail closed', () => {
  const evidence = syntheticEvidence();
  evidence.approval.fromOldOwnerV3 = true;
  assert.throws(
    () => inspectProposedStagingAdmission(evidence),
    /NEW_OWNER_APPROVAL_SCOPE_REQUIRED/
  );
  delete evidence.approval.fromOldOwnerV3;
  evidence.untrustedApiKey = 'never-pass-secrets';
  assert.throws(
    () => inspectProposedStagingAdmission(evidence),
    /EVIDENCE_FIELDS/
  );
});

test('live execution is always disabled, including synthetic fully shaped evidence', async () => {
  await assert.rejects(
    executeStagingCutover(syntheticEvidence(), { force: true }),
    /NO_TRUSTED_LIVE_EXECUTION_ADAPTER/
  );
});
