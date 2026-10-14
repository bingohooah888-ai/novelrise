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

test('staging candidate preparation is read-only, not a live approval', () => {
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

test('candidate SHA and current main must be distinct and exact', () => {
  deny({ mainSha: 'main', candidateSha }, /exact 40-character SHAs/u);
  deny({ mainSha, candidateSha: mainSha }, /must not be confused/u);
});

test('missing artifacts fail before any Staging operation', () => {
  deny(
    {
      mainSha,
      candidateSha,
      read: () => {
        throw new Error('missing');
      },
    },
    /missing required review artifact/u
  );
});

test('migration must not enable the public database gate', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  deny(
    {
      mainSha,
      candidateSha,
      read: (path) => {
        const sql = readFileSync(resolve(root, path), 'utf8');
        return path === COMMUNITY_PREP_PATHS[0]
          ? sql +
              '\nUPDATE public.community_runtime_control SET public_enabled=true;'
          : sql;
      },
    },
    /must never enable/u
  );
});
