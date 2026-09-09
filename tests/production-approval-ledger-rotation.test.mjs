import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const contract = JSON.parse(
  await readFile('production-approval-ledger.json', 'utf8')
);

const activeIssue = contract.activeIssue;
const legacyIssue = contract.legacyIssues[0];

async function read(path) {
  return readFile(path, 'utf8');
}

test('active shared Production approval routes are pinned to the v2 ledger', async () => {
  assert.equal(activeIssue, 460);
  assert.deepEqual(contract.legacyIssues, [165]);
  assert.equal(contract.maxComments, 100);

  for (const path of contract.activeSharedRoutes) {
    const source = await read(path);
    assert.match(
      source,
      new RegExp(`github\\.event\\.issue\\.number == ${activeIssue}`),
      `${path} must accept only the active shared ledger`
    );
    assert.doesNotMatch(
      source,
      new RegExp(`github\\.event\\.issue\\.number == ${legacyIssue}`),
      `${path} must reject the exhausted legacy ledger`
    );
    assert.doesNotMatch(
      source,
      new RegExp(`ISSUE_NUMBER: ['\"]${legacyIssue}['\"]`),
      `${path} must not write claims or results to the legacy ledger`
    );
  }
});

test('active mutation bridges keep the bounded ledger fail-closed contract', async () => {
  for (const path of [
    '.github/workflows/production-migration-approved-dispatch.yml',
    '.github/workflows/production-auth-smoke-approved-dispatch.yml'
  ]) {
    const source = await read(path);
    assert.match(source, /comment_count=.*jq 'length'/);
    assert.match(source, /\[ "\$comment_count" -lt 100 \]/);
    assert.match(
      source,
      /Production Approval Ledger exceeded the bounded comment contract/
    );
  }
});

test('completed one-time baseline repair stays retired on the legacy ledger', async () => {
  assert.deepEqual(contract.retiredLegacyRoutes, [
    '.github/workflows/production-approved-dispatch.yml'
  ]);

  const source = await read(contract.retiredLegacyRoutes[0]);
  assert.match(
    source,
    new RegExp(`github\\.event\\.issue\\.number == ${legacyIssue}`)
  );
  assert.doesNotMatch(
    source,
    new RegExp(`github\\.event\\.issue\\.number == ${activeIssue}`)
  );
  assert.match(source, /supabase-baseline-history-repair/);
  assert.match(source, /REPAIR_VERSION: '20260815000000'/);
  assert.doesNotMatch(source, /supabase db push --linked --yes/);
});

test('dedicated billing approval issues remain separate from the shared ledger', async () => {
  const source = await read('.github/workflows/production-chat-approval.yml');
  assert.doesNotMatch(
    source,
    new RegExp(`github\\.event\\.issue\\.number == ${activeIssue}`)
  );
  assert.doesNotMatch(
    source,
    new RegExp(`github\\.event\\.issue\\.number == ${legacyIssue}`)
  );
});
