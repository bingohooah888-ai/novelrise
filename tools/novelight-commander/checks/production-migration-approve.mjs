import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductionMigrationApprovalBody,
  parseProductionMigrationApproveRequest,
  productionMigrationApprovalContract
} from '../src/production-migration-approve-bridge.js';

const owner = {
  user: { login: 'bingohooah888-ai' },
  author_association: 'OWNER'
};

function requestComment(action, args) {
  return {
    ...owner,
    body:
      productionMigrationApprovalContract.requestPrefix +
      JSON.stringify({
        version: 1,
        requestId: 'cmdr-20260927T130000Z-prodapprove1',
        action,
        args
      })
  };
}

test('accepts fixed read-only preflight request', () => {
  const parsed = parseProductionMigrationApproveRequest(
    requestComment('production_migration_preflight', {
      mainSha: 'a'.repeat(40),
      confirmation: 'CHAT_PRODUCTION_APPROVED'
    })
  );
  assert.equal(parsed.action, 'production_migration_preflight');
});

test('accepts fixed deploy approval request', () => {
  const parsed = parseProductionMigrationApproveRequest(
    requestComment('production_migration_deploy_approve', {
      mainSha: 'b'.repeat(40),
      challenge: '12AB34CD',
      migrations: ['20260927130000'],
      confirmation: 'CHAT_PRODUCTION_APPROVED'
    })
  );
  assert.deepEqual(parsed.args.migrations, ['20260927130000']);
});

test('builds exact existing Production ledger approval payload', () => {
  assert.equal(
    buildProductionMigrationApprovalBody({
      mainSha: 'c'.repeat(40),
      challenge: '019873A3',
      migrations: ['20260927130000']
    }),
    'NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_APPROVE ' +
      JSON.stringify({
        operation: 'supabase-migration-deploy',
        mainSha: 'c'.repeat(40),
        challenge: '019873A3',
        migrations: ['20260927130000']
      })
  );
});

test('rejects non-owner comments', () => {
  assert.equal(
    parseProductionMigrationApproveRequest({
      user: { login: 'someone-else' },
      author_association: 'CONTRIBUTOR',
      body: productionMigrationApprovalContract.requestPrefix + '{}'
    }),
    null
  );
});

test('rejects missing explicit Production confirmation', () => {
  assert.throws(
    () =>
      parseProductionMigrationApproveRequest(
        requestComment('production_migration_deploy_approve', {
          mainSha: 'd'.repeat(40),
          challenge: '89ABCDEF',
          migrations: ['20260927130000'],
          confirmation: 'NO'
        })
      ),
    /Explicit chat Production approval is required/
  );
});

test('rejects extra args and non-canonical migration lists', () => {
  assert.throws(
    () =>
      parseProductionMigrationApproveRequest(
        requestComment('production_migration_deploy_approve', {
          mainSha: 'e'.repeat(40),
          challenge: '89ABCDEF',
          migrations: ['20260927130000'],
          confirmation: 'CHAT_PRODUCTION_APPROVED',
          extra: true
        })
      ),
    /args do not match the fixed contract/
  );

  assert.throws(
    () =>
      parseProductionMigrationApproveRequest(
        requestComment('production_migration_deploy_approve', {
          mainSha: 'e'.repeat(40),
          challenge: '89ABCDEF',
          migrations: ['20260927130000', '20260927130000'],
          confirmation: 'CHAT_PRODUCTION_APPROVED'
        })
      ),
    /duplicates/
  );
});

test('contract is pinned to NLO control and Production ledger issues', () => {
  assert.equal(productionMigrationApprovalContract.controlIssue, 797);
  assert.equal(productionMigrationApprovalContract.ledgerIssue, 737);
  assert.equal(
    productionMigrationApprovalContract.confirmation,
    'CHAT_PRODUCTION_APPROVED'
  );
});
