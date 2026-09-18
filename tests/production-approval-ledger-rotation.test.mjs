import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const contract = JSON.parse(
  await readFile('production-approval-ledger.json', 'utf8')
);

const activeIssue = contract.activeIssue;
const legacyIssues = contract.legacyIssues;
const baselineLegacyIssue = legacyIssues[0];

async function read(path) {
  return readFile(path, 'utf8');
}

test('active shared Production approval routes are pinned to the v3 ledger', async () => {
  assert.equal(activeIssue, 657);
  assert.deepEqual(legacyIssues, [165, 460]);
  assert.equal(contract.maxComments, 100);

  for (const path of contract.activeSharedRoutes) {
    const source = await read(path);
    assert.match(
      source,
      new RegExp(`github\\.event\\.issue\\.number == ${activeIssue}`),
      `${path} must accept only the active shared ledger`
    );
    for (const legacyIssue of legacyIssues) {
      assert.doesNotMatch(
        source,
        new RegExp(`github\\.event\\.issue\\.number == ${legacyIssue}`),
        `${path} must reject legacy ledger #${legacyIssue}`
      );
      assert.doesNotMatch(
        source,
        new RegExp(`ISSUE_NUMBER: ['\"]${legacyIssue}['\"]`),
        `${path} must not write claims or results to legacy ledger #${legacyIssue}`
      );
    }
  }
});

test('active mutation bridges keep the bounded ledger fail-closed contract', async () => {
  for (const path of [
    '.github/workflows/production-migration-approved-dispatch.yml',
    '.github/workflows/production-auth-smoke-approved-dispatch.yml',
    '.github/workflows/vercel-admin-allowlist.yml'
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

test('Vercel ADMIN control uses only the active ledger and preserves dedicated success proof', async () => {
  const source = await read('.github/workflows/vercel-admin-allowlist.yml');

  assert.match(source, new RegExp(`LEDGER_ISSUE: ['"]${activeIssue}['"]`));
  assert.doesNotMatch(source, /CONTROL_ISSUE/);
  for (const legacyIssue of legacyIssues) {
    assert.doesNotMatch(
      source,
      new RegExp(`LEDGER_ISSUE: ['"]${legacyIssue}['"]`)
    );
  }
  assert.match(source, /production-approval-ledger\.json/);
  assert.match(
    source,
    /active Production Approval Ledger is not open and writable/
  );
  assert.match(source, /admin-allowlist-dedicated-issues\.txt/);
  assert.match(source, /github-actions\[bot\]/);
  assert.match(
    source,
    /successful CONSUMED proof already exists; skipping a contradictory FAILED marker/
  );
  assert.match(
    source,
    /Production verification succeeded before audit persistence failed; recovering success proof without repeating Production work/
  );
});

test('completed one-time baseline repair stays retired on the original legacy ledger', async () => {
  assert.deepEqual(contract.retiredLegacyRoutes, [
    '.github/workflows/production-approved-dispatch.yml'
  ]);

  const source = await read(contract.retiredLegacyRoutes[0]);
  assert.match(
    source,
    new RegExp(`github\\.event\\.issue\\.number == ${baselineLegacyIssue}`)
  );
  assert.doesNotMatch(
    source,
    new RegExp(`github\\.event\\.issue\\.number == ${activeIssue}`)
  );
  assert.match(source, /supabase-baseline-history-repair/);
  assert.match(source, /REPAIR_VERSION: '20260815000000'/);
  assert.doesNotMatch(source, /supabase db push --linked --yes/);
});

test('dedicated billing approval issues remain separate from shared and legacy ledgers', async () => {
  const source = await read('.github/workflows/production-chat-approval.yml');
  assert.doesNotMatch(
    source,
    new RegExp(`github\\.event\\.issue\\.number == ${activeIssue}`)
  );
  for (const legacyIssue of legacyIssues) {
    assert.doesNotMatch(
      source,
      new RegExp(`github\\.event\\.issue\\.number == ${legacyIssue}`)
    );
  }
});
