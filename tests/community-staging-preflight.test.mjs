import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  COMMUNITY_PREP_PATHS,
  verifyCommunityStagingPreparation,
  inspectCommunityStagingLedger
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
        'SET public_enabled=true;'
      ].join('\n');
    }
    return sql;
  };
  deny({ mainSha, candidateSha, read }, /must never enable/u);
});

const productionRef = 'fiepaguycecrredwrcwx';
const stagingRef = 'wmlzjgvxgoyrovdhbqbg';
const common = { version: '20261013235500', name: 'known_baseline' };
const community = {
  version: '20261014052000',
  name: 'community_plaza_phase1'
};
const prodRecent = {
  version: '20261022010000',
  name: 'author_activity_publication_timestamps'
};
const prodNewest = {
  version: '20261022010100',
  name: 'author_activity_first_episode'
};
const observed = {
  productionRef,
  stagingRef,
  productionLedgerComplete: true,
  stagingLedgerComplete: true,
  stagingManagementStatus: 'MIGRATIONS_FAILED',
  productionMigrations: [common, prodRecent, prodNewest],
  stagingMigrations: [common, community]
};

function inspect(overrides = {}) {
  return inspectCommunityStagingLedger({ ...observed, ...overrides });
}

function invalid(overrides, pattern) {
  assert.throws(() => inspect(overrides), pattern);
}

test('observed migration drift cannot authorize staging', () => {
  const audit = inspect();
  assert.equal(audit.verdict, 'READ_ONLY_LEDGER_AUDIT');
  assert.deepEqual(audit.productionOnly, [
    '20261022010000',
    '20261022010100'
  ]);
  assert.deepEqual(audit.stagingOnly, ['20261014052000']);
  assert.deepEqual(audit.nameConflicts, []);
  assert.ok(audit.blockers.includes('migration history differs'));
  assert.ok(audit.blockers.includes('staging management is not ready'));
  assert.equal(audit.canSyncOrReset, false);
  assert.equal(audit.canRunHostedAcceptance, false);
  assert.equal(audit.canMergeOrDeployProduction, false);
  assert.equal(audit.stagingExecutionApproved, false);
});

test('audit rejects wrong environment and incomplete snapshots', () => {
  invalid({ stagingRef: productionRef }, /resource identities/u);
  invalid({ stagingLedgerComplete: false }, /incomplete/u);
  invalid({ productionLedgerComplete: undefined }, /incomplete/u);
});

test('audit rejects duplicated or malformed migration versions', () => {
  invalid({ stagingMigrations: [common, community, community] }, /repeated/u);
  const malformed = [{ version: 'main', name: 'bad' }];
  invalid({ productionMigrations: malformed }, /malformed/u);
  invalid({ productionMigrations: [] }, /missing or unbounded/u);
});

test('same version with altered migration name must be surfaced', () => {
  const audit = inspect({
    stagingMigrations: [{ ...common, name: 'different_baseline' }, community]
  });
  assert.deepEqual(audit.nameConflicts, ['20261013235500']);
  assert.equal(audit.canSyncOrReset, false);
});

test('matching ledgers still cannot authorize writes', () => {
  const ledger = [common, community];
  const audit = inspect({
    productionMigrations: ledger,
    stagingMigrations: ledger,
    stagingManagementStatus: 'FUNCTIONS_DEPLOYED'
  });
  assert.deepEqual(audit.productionOnly, []);
  assert.deepEqual(audit.stagingOnly, []);
  assert.equal(audit.stagingExecutionApproved, false);
  assert.equal(audit.canRunHostedAcceptance, false);
  assert.equal(audit.canSyncOrReset, false);
  const productionGate = 'community already recorded in production';
  assert.ok(audit.blockers.includes(productionGate));
});
