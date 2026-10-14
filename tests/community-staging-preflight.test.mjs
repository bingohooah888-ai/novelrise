import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMUNITY_PREP_PATHS,
  verifyCommunityStagingPreparation,
} from '../scripts/community-staging-preflight.mjs';

const mainSha = 'a40dcf9a0cc7a841c95c075aa448ec794f4fb470';
const candidateSha = 'dea73cd3287ac1629db6292b0aa0deca28ad272a';

test('community staging candidate preparation is read-only and not an approval', () => {
  const report = verifyCommunityStagingPreparation({ mainSha, candidateSha });
  assert.equal(report.result, 'PREPARATION_ONLY');
  assert.equal(report.prNumber, 2222);
  assert.equal(report.stagingExecutionApproved, false);
  assert.equal(report.environmentTouched, false);
  assert.equal(report.canExecuteStaging, false);
  assert.equal(report.canCreatePreview, false);
  assert.equal(report.canMergeOrDeployProduction, false);
  assert.equal(report.approvalLedger, 'Issue #294');
  assert.deepEqual(report.candidateArtifacts, COMMUNITY_PREP_PATHS);
});

test('candidate SHA and current main must be distinct, exact and provided', () => {
  assert.throws(() => verifyCommunityStagingPreparation({
    mainSha: 'main',
    candidateSha,
  }), /exact 40-character SHAs/u);
  assert.throws(() => verifyCommunityStagingPreparation({
    mainSha,
    candidateSha: mainSha,
  }), /must not be confused/u);
});

test('missing migration artifacts fail before any staging operation', () => {
  assert.throws(() => verifyCommunityStagingPreparation({
    mainSha,
    candidateSha,
    read: () => {
      throw new Error('missing');
    },
  }), /missing required review artifact/u);
});

test('fails closed if database gate would be enabled in migration', () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  assert.throws(() => verifyCommunityStagingPreparation({
    mainSha,
    candidateSha,
    read: (path) => {
      const sql = readFileSync(resolve(root, path), 'utf8');
      return path === COMMUNITY_PREP_PATHS[0]
        ? sql + '\nUPDATE public.community_runtime_control SET public_enabled=true;'
        : sql;
    },
  }), /must never enable/u);
});
