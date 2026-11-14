import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(path, 'utf8');

test('pre-merge Staging workflows prove the four approved migration digests before strict parity', async () => {
  for (const file of [
    '.github/workflows/staging-candidate-db-persistent-apply.yml',
    '.github/workflows/staging-candidate-db-rollback-check.yml'
  ]) {
    const source = await read(file);
    const proof = source.indexOf(
      'bash scripts/verify-staging-migrations.sh prepare-staging-only'
    );
    const parity = source.indexOf(
      'find supabase/migrations -maxdepth 1 -type f'
    );
    const decision = source.indexOf(
      'diff -u /tmp/staging-main-migration-versions /tmp/staging-baseline-versions'
    );
    assert.ok(proof > 0 && parity > proof && decision > parity, file);
    assert.match(source, /node scripts\/verify-staging-migration-target\.mjs/u);
    assert.match(
      source,
      /test "\$STAGING_SUPABASE_URL" = 'https:\/\/wmlzjgvxgoyrovdhbqbg\.supabase\.co'/u
    );
    assert.match(
      source,
      /NOVELIGHT_STAGING_CANDIDATE_(?:CHECK|PERSIST)_APPROVE/u
    );
    assert.match(
      source,
      /github\.event\.comment\.author_association == 'OWNER'/u
    );
  }
});

test('PNG pre/postcheck run inside the trusted single Staging transaction', async () => {
  const version = '20261114121000';
  const base =
    'supabase/checks/' +
    version +
    '_episode_illustration_png_delivery_consistency_';
  for (const path of [base + 'precheck.sql', base + 'postcheck.sql']) {
    const source = await read(path);
    assert.doesNotMatch(source, /^\s*(?:begin|commit|rollback)\s*;/imu);
    assert.match(source, /do \$\$/iu);
  }
});

test('generic candidate path stays fail-closed for privileged illustration SQL', async () => {
  const { composeCandidatePersistentSql } =
    await import('../scripts/staging-candidate-persist-sql.mjs');
  const pre = await read(
    'supabase/checks/20261114121000_episode_illustration_png_delivery_consistency_precheck.sql'
  );
  const migration = await read(
    'supabase/migrations/20261114121000_episode_illustration_png_delivery_consistency.sql'
  );
  const post = await read(
    'supabase/checks/20261114121000_episode_illustration_png_delivery_consistency_postcheck.sql'
  );
  assert.throws(
    () =>
      composeCandidatePersistentSql({
        version: '20261114121000',
        migrationFile:
          '20261114121000_episode_illustration_png_delivery_consistency.sql',
        precheck: pre,
        migration,
        postcheck: post
      }),
    /DENIED/u
  );
  assert.match(migration, /security definer/iu);
});
