import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(
  await readFile('production-approval-ledger.json', 'utf8')
);

test('NLO Production bridges target the active ledger and current control issue', async () => {
  assert.equal(config.activeIssue, 2139);
  assert.ok(config.legacyIssues.includes(1433));
  assert.equal(config.maxComments, 100);

  for (const path of [
    'tools/novelight-commander/src/production-migration-approve-bridge.js',
    'tools/novelight-commander/src/production-auth-smoke-dispatch-bridge.js'
  ]) {
    const source = await readFile(path, 'utf8');
    assert.match(source, /const CONTROL_ISSUE = 1837;/);
    assert.match(
      source,
      new RegExp(`const LEDGER_ISSUE = ${config.activeIssue};`)
    );
    assert.doesNotMatch(source, /const CONTROL_ISSUE = 797;/);
    assert.doesNotMatch(source, /const LEDGER_ISSUE = (737|1433);/);
  }
});
