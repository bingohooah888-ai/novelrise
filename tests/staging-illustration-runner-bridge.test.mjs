import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ILLUSTRATION_PINNED,
  composePinnedIllustrationSql
} from '../scripts/staging-illustration-pinned-sql.mjs';

const workflowPaths = [
  '.github/workflows/staging-candidate-db-persistent-apply.yml',
  '.github/workflows/staging-candidate-db-rollback-check.yml'
];
const read = (path) => readFile(path, 'utf8');

test('one immutable PNG migration and four reviewed Git blobs', () => {
  assert.equal(ILLUSTRATION_PINNED.pr, 2861);
  assert.equal(ILLUSTRATION_PINNED.version, '20261114121000');
  assert.equal(
    ILLUSTRATION_PINNED.file,
    '20261114121000_episode_illustration_png_delivery_consistency.sql'
  );
  assert.deepEqual(ILLUSTRATION_PINNED.blobs, {
    migration: '6ec298c8796e2d3c94f8e561ebb2cf966e41ed31',
    precheck: '6ee0f80b7dc0df8279f756965343b9b2d4aa045c',
    postcheck: '84e2a06d4a3fe058b1112f3dfecd690e6c6509a5',
    rollback: '84a8f89c7332d04e17bf183e7ef8735cf3dac9d0'
  });
});

test('generic privilege checks unchanged and unreviewed SQL fails closed', async () => {
  const source = await read('scripts/staging-candidate-sql.mjs');
  assert.ok(source.includes('security\\s+definer'));
  const artifacts = {
    migration: 'BEGIN;\nSELECT 1;\nCOMMIT;\n',
    precheck: 'SELECT 1;',
    postcheck: 'SELECT 1;',
    rollback: 'SELECT 1;'
  };
  const candidate = {
    pr: 2861,
    version: '20261114121000',
    migrationFile:
      '20261114121000_episode_illustration_png_delivery_consistency.sql',
    mode: 'check',
    artifacts
  };
  for (const alteration of [
    {},
    { pr: 2862 },
    { version: '20261114121001' },
    { mode: 'deploy' },
    { mode: 'persist' },
    { artifacts: { ...artifacts, precheck: 'SELECT 2;' } },
    { artifacts: { ...artifacts, rollback: 'ROLLBACK;' } },
    { artifacts: { migration: artifacts.migration } }
  ]) {
    assert.throws(
      () => composePinnedIllustrationSql({ ...candidate, ...alteration }),
      /DENIED/u
    );
  }
});

test('Staging workflows remain one-use OWNER issue-comment only', async () => {
  for (const path of workflowPaths) {
    const workflow = await read(path);
    assert.match(workflow, /^on:\s*\n\s+issue_comment:/mu);
    assert.doesNotMatch(workflow, /workflow_dispatch:/u);
    assert.ok(workflow.includes('github.event.issue.number == 294'));
    assert.ok(workflow.includes("github.actor == 'bingohooah888-ai'"));
    assert.ok(
      workflow.includes("github.triggering_actor == 'bingohooah888-ai'")
    );
    assert.ok(
      workflow.includes("github.event.comment.author_association == 'OWNER'")
    );
    assert.ok(
      workflow.includes('Checkout trusted main only, not the candidate branch')
    );
    assert.ok(workflow.includes('CLAIM one-time approval'));
    assert.ok(workflow.includes('Consume Staging approval exactly once'));
    assert.ok(
      workflow.includes(
        'test "$STAGING_SUPABASE_URL" = \'https://wmlzjgvxgoyrovdhbqbg.supabase.co\''
      )
    );
    assert.ok(
      workflow.includes('node scripts/verify-staging-migration-target.mjs')
    );
  }
});

test('Staging-only SQL digest proof precedes strict history parity', async () => {
  for (const path of workflowPaths) {
    const workflow = await read(path);
    const proof = workflow.indexOf(
      'bash scripts/verify-staging-migrations.sh prepare-staging-only'
    );
    const versions = workflow.indexOf(
      'find supabase/migrations -maxdepth 1 -type f'
    );
    const parity = workflow.indexOf(
      'diff -u /tmp/staging-main-migration-versions /tmp/staging-baseline-versions'
    );
    assert.ok(proof > 0 && versions > proof && parity > versions);
    assert.ok(
      workflow.includes('test -s /tmp/staging-main-migration-versions')
    );
    assert.ok(workflow.includes('if grep -Fxq "$MIGRATION"'));
  }
});

test('only PR 2861 routes to pinned check/persist; generic fallback remains', async () => {
  const persist = await read(workflowPaths[0]);
  const check = await read(workflowPaths[1]);
  for (const workflow of [persist, check]) {
    assert.ok(
      workflow.includes(
        '"$PR_NUMBER" == \'2861\' && "$MIGRATION" == \'20261114121000\''
      )
    );
    assert.ok(
      workflow.includes('scripts/staging-illustration-pinned-sql.mjs compose')
    );
    assert.ok(workflow.includes('git hash-object "$root/$kind.sql"'));
    assert.ok(workflow.includes('= "$CANDIDATE"'));
  }
  assert.ok(persist.includes('"$PR_NUMBER" == \'2698\''));
  assert.ok(
    persist.includes('scripts/staging-candidate-persist-sql.mjs compose')
  );
  assert.ok(persist.includes('"$PR_NUMBER" persist'));
  assert.ok(check.includes('scripts/staging-candidate-sql.mjs compose'));
  assert.ok(check.includes('"$PR_NUMBER" check'));
});
