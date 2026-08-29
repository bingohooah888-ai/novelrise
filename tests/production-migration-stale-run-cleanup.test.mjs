import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectStaleMigrationRunForCleanup,
} from '../scripts/cleanup-stale-production-migration-run.mjs';

const currentMain = 'b'.repeat(40);
const oldMain = '9'.repeat(40);

function botRun(overrides = {}) {
  return {
    id: 33240227368,
    status: 'waiting',
    conclusion: null,
    event: 'workflow_dispatch',
    head_sha: oldMain,
    actor: { login: 'github-actions[bot]' },
    ...overrides,
  };
}

function dispatchComment(overrides = {}) {
  const record = {
    operation: 'supabase-migration-deploy',
    mainSha: oldMain,
    challenge: '65744591',
    migrations: ['20260828223000', '20260828224000'],
    bridgeRunId: '33240224069',
    targetWorkflow: 'supabase-production.yml',
    ...overrides,
  };

  return {
    body: `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_DISPATCHED ${JSON.stringify(record)}`,
  };
}

function select({ runs = [], ledgerComments = [] } = {}) {
  return selectStaleMigrationRunForCleanup({
    runs,
    ledgerComments,
    expectedMainSha: currentMain,
    manualWorkflow: 'supabase-production.yml',
  });
}

test('no active manual run requires no cleanup', () => {
  assert.equal(select(), null);
});

test('a human-started active manual run fails closed', () => {
  assert.throws(
    () =>
      select({
        runs: [
          botRun({
            actor: { login: 'bingohooah888-ai' },
            event: 'workflow_dispatch',
          }),
        ],
      }),
    /human-started Supabase Production workflow is still active/
  );
});

test('multiple active bot manual runs fail closed', () => {
  assert.throws(
    () => select({ runs: [botRun(), botRun({ id: 33240227369 })] }),
    /multiple stale bot-dispatched Production migration runs require manual investigation/
  );
});

test('the only bot run must be waiting before it can be cancelled', () => {
  assert.throws(
    () =>
      select({
        runs: [botRun({ status: 'in_progress' })],
        ledgerComments: [dispatchComment()],
      }),
    /is in_progress, not waiting/
  );
});

test('a bot run for the requested main fails closed as a duplicate', () => {
  assert.throws(
    () =>
      select({
        runs: [botRun({ head_sha: currentMain })],
        ledgerComments: [dispatchComment({ mainSha: currentMain })],
      }),
    /already exists for the requested main/
  );
});

test('a stale waiting bot run requires exactly one matching bridge dispatch', () => {
  assert.throws(
    () => select({ runs: [botRun()] }),
    /not uniquely backed by the prior bridge ledger/
  );

  assert.throws(
    () =>
      select({
        runs: [botRun()],
        ledgerComments: [dispatchComment(), dispatchComment()],
      }),
    /not uniquely backed by the prior bridge ledger/
  );
});

test('baseline or malformed migration scope cannot authorize stale-run cleanup', () => {
  assert.throws(
    () =>
      select({
        runs: [botRun()],
        ledgerComments: [
          dispatchComment({ migrations: ['20260815000000'] }),
        ],
      }),
    /not uniquely backed by the prior bridge ledger/
  );
});

test('exact old-main bridge evidence selects only the stale waiting bot run', () => {
  const staleRun = botRun();
  const selected = select({
    runs: [staleRun],
    ledgerComments: [
      { body: 'unrelated comment' },
      dispatchComment(),
      dispatchComment({
        mainSha: '8'.repeat(40),
        bridgeRunId: '111',
      }),
    ],
  });

  assert.equal(selected, staleRun);
});
