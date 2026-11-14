import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ILLUSTRATION_PINNED,
  composePinnedIllustrationSql
} from '../scripts/staging-illustration-pinned-sql.mjs';
import { gitBlobSha } from '../scripts/staging-follow-list-pinned-sql.mjs';

const paths = {
  migration:
    'supabase/migrations/20261114121000_episode_illustration_png_delivery_consistency.sql',
  precheck:
    'supabase/checks/20261114121000_episode_illustration_png_delivery_consistency_precheck.sql',
  postcheck:
    'supabase/checks/20261114121000_episode_illustration_png_delivery_consistency_postcheck.sql',
  rollback:
    'supabase/rollback/20261114121000_episode_illustration_png_delivery_consistency_rollback.sql'
};

const artifacts = Object.fromEntries(
  await Promise.all(
    Object.entries(paths).map(async ([kind, file]) => [
      kind,
      await readFile(file, 'utf8')
    ])
  )
);
const candidate = {
  pr: 2861,
  version: '20261114121000',
  migrationFile:
    '20261114121000_episode_illustration_png_delivery_consistency.sql',
  artifacts
};

test('trusted-main exception pins all FOUR immutable candidate SQL Git blobs', () => {
  for (const [kind, source] of Object.entries(artifacts)) {
    assert.equal(gitBlobSha(source), ILLUSTRATION_PINNED.blobs[kind]);
  }
  assert.equal(Object.keys(ILLUSTRATION_PINNED.blobs).length, 4);
});

test('pinned PNG check never commits and persistent path uses an atomic ledger', () => {
  const check = composePinnedIllustrationSql({ ...candidate, mode: 'check' });
  const persist = composePinnedIllustrationSql({
    ...candidate,
    mode: 'persist'
  });
  assert.equal((check.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((check.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.doesNotMatch(check, /^COMMIT;$/mu);
  assert.doesNotMatch(check, /INSERT INTO supabase_migrations/iu);
  assert.equal((persist.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((persist.match(/^COMMIT;$/gm) || []).length, 1);
  assert.doesNotMatch(persist, /^ROLLBACK;$/mu);
  assert.ok(
    persist.indexOf('POSTCHECK PASS') <
      persist.indexOf('INSERT INTO supabase_migrations')
  );
  assert.ok(
    persist.indexOf('INSERT INTO supabase_migrations') <
      persist.lastIndexOf('COMMIT;')
  );
  assert.match(persist, /security definer/iu);
});

test('unreviewed changes to security-definer SQL and all identity drifts are denied', () => {
  for (const wrong of [
    { pr: 2698 },
    { pr: 2862 },
    { version: '20261114121001' },
    { migrationFile: '20261114121000_different.sql' },
    { mode: 'main' },
    {
      mode: 'persist',
      artifacts: {
        ...artifacts,
        migration: artifacts.migration + '\nselect 1;'
      }
    },
    {
      mode: 'persist',
      artifacts: { ...artifacts, precheck: artifacts.precheck + '\n' }
    },
    {
      mode: 'persist',
      artifacts: { ...artifacts, postcheck: artifacts.postcheck + '\n' }
    },
    {
      mode: 'persist',
      artifacts: { ...artifacts, rollback: artifacts.rollback + '\n' }
    }
  ]) {
    assert.throws(
      () =>
        composePinnedIllustrationSql({
          ...candidate,
          mode: 'persist',
          ...wrong
        }),
      /DENIED/u
    );
  }
});

test('no general SQL compiler relaxations or unapproved automatic deployment', async () => {
  const generic = await readFile('scripts/staging-candidate-sql.mjs', 'utf8');
  assert.ok(generic.includes('security\\s+definer'));
  const workflows = await Promise.all([
    readFile(
      '.github/workflows/staging-candidate-db-persistent-apply.yml',
      'utf8'
    ),
    readFile(
      '.github/workflows/staging-candidate-db-rollback-check.yml',
      'utf8'
    )
  ]);
  for (const source of workflows) {
    assert.match(
      source,
      /NOVELIGHT_STAGING_CANDIDATE_(?:CHECK|PERSIST)_APPROVE/u
    );
    assert.ok(
      source.includes("github.event.comment.author_association == 'OWNER'")
    );
    assert.match(source, /staging-illustration-pinned-sql\.mjs/u);
    assert.match(source, /PR_NUMBER.*2861.*MIGRATION.*20261114121000/u);
  }
});

test('retention recovery is pinned to Staging baseline and rollback restores both functions', async () => {
  const pre = await readFile(
    'supabase/recovery/staging-retention-20261110/precheck.sql',
    'utf8'
  );
  const rb = await readFile(
    'supabase/recovery/staging-retention-20261110/rollback.sql',
    'utf8'
  );
  for (const sha of [
    '84db65f80613f2e1e15cab8f66c973981bdd56260ac3b866da66b29284c67653',
    'e2879f44469f2cc5d4f33d5969a4b8a85ae17fa13ffb50e93c87fa136be943c3'
  ]) {
    assert.match(pre, new RegExp(sha, 'u'));
    assert.match(rb, new RegExp(sha, 'u'));
  }
  assert.match(pre, /Retention precheck: Staging function definition drift/u);
  assert.match(pre, /schema_migrations/u);
  assert.match(
    rb,
    /CREATE OR REPLACE FUNCTION public\.novelight_author_exposure_funnel_v2/u
  );
  assert.match(
    rb,
    /CREATE OR REPLACE FUNCTION public\.novelight_author_analytics_timeseries/u
  );
  assert.match(rb, /security definer/iu);
  assert.match(rb, /WHERE version::text='20261110172000'/u);
  assert.doesNotMatch(rb, /DELETE FROM public\./iu);
  assert.doesNotMatch(rb, /DROP TABLE|DROP FUNCTION/iu);
});
