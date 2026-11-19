import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflowPath =
  '../.github/workflows/production-migration-approved-dispatch.yml';
const workflow = readFileSync(new URL(workflowPath, import.meta.url), 'utf8');
const pinned = '8f9e81effe7f2a116460ea8538aea553d1775cc0';

test('reply-history deploy is pinned to one migration', () => {
  const before = workflow.indexOf('name: Isolate Staging-only AI migration');
  const check = workflow.indexOf('name: Require approved pending migrations');
  const dryRunCommand = 'run: supabase db push --linked --dry-run --include-all';
  const deployCommand = 'run: supabase db push --linked --yes --include-all';
  const dry = workflow.indexOf(dryRunCommand);
  const deploy = workflow.indexOf(deployCommand);
  const after = workflow.indexOf('name: Verify production migration status');
  const approved = `if: env.APPROVED_MIGRATIONS == '20261118221000'`;
  const pair = "printf '%s\\n' '20261101060000' '20261118221000'";

  assert.ok(before >= 0);
  assert.ok(before < check && check < dry && dry < deploy && deploy < after);
  const isolation = workflow.slice(before, check);
  assert.equal(workflow.split(approved).length - 1, 1);
  assert.ok(isolation.includes(approved));
  assert.ok(isolation.includes(`pinned_blob='${pinned}'`));
  assert.ok(isolation.includes('git hash-object "$staging_only"'));
  assert.ok(isolation.includes(pair));
  assert.ok(isolation.includes('diff -u /tmp/reply-history-expected.txt'));
  assert.ok(isolation.includes('mv -- "$staging_only" "$isolated"'));
});

test('postcheck restores the AI migration without applying it', () => {
  const after = workflow.indexOf('name: Verify production migration status');
  assert.ok(after >= 0);
  const postcheck = workflow.slice(after);
  const expected = "expected_pending='20261101060000'";
  assert.ok(postcheck.includes(expected));
  assert.ok(postcheck.includes('mv -- "$isolated" "$staging_only"'));
  assert.ok(postcheck.includes('git hash-object "$staging_only"'));
  assert.ok(postcheck.includes(pinned));
  assert.ok(postcheck.includes('if [ "$pending_migrations" != "$expected_pending" ]; then'));
});
