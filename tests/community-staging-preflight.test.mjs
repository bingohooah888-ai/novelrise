import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  COMMUNITY_PREP_PATHS,
  verifyCommunityStagingPreparation,
} from '../scripts/community-staging-preflight.mjs';

const mainSha = 'a40dcf9a0cc7a841c95c075aa448ec794f4fb470';
const candidateSha = 'dea73cd3287ac1629db6292b0aa0deca28ad272a';

function deny(input, message) {
  assert.throws(() => verifyCommunityStagingPreparation(input), message);
}

test('staging manifest is read-only', () => {
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

test('candidate and main SHAs must be distinct and exact', () => {
  deny({ mainSha: 'main', candidateSha }, /exact 40-character SHAs/u);
  deny({ mainSha, candidateSha: mainSha }, /must not be confused/u);
});

test('missing files fail before Staging operations', () => {
  const read = () => {
    throw new Error('missing');
  };
  deny({ mainSha, candidateSha, read }, /missing required review artifact/u);
});

test('migration must leave the public database gate disabled', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (path) => {
    const sql = readFileSync(resolve(root, path), 'utf8');
    if (path === COMMUNITY_PREP_PATHS[0]) {
      return [
        sql,
        'UPDATE public.community_runtime_control',
        'SET public_enabled=true;',
      ].join('\n');
    }
    return sql;
  };
  deny({ mainSha, candidateSha, read }, /must never enable/u);
});
