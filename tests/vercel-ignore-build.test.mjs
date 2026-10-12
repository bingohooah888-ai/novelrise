import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  readChangedPaths,
  shouldIgnoreProductionBuild
} from '../scripts/vercel-ignore-build.mjs';

const production = (changedPaths, overrides = {}) => ({
  environment: 'production',
  ref: 'main',
  changedPaths,
  ...overrides
});

test('Vercel configuration retains main-only deploys and uses the guard', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.git.deploymentEnabled, { '**': false, main: true });
  assert.equal(config.ignoreCommand, 'node scripts/vercel-ignore-build.mjs');
});

test('documentation, workflow and test-only commits skip Production build', () => {
  assert.equal(
    shouldIgnoreProductionBuild(
      production(['README.md', 'docs/release-notes.md', '.github/workflows/ci.yml', 'tests/health.test.mjs'])
    ),
    true
  );
  assert.equal(shouldIgnoreProductionBuild(production(['AGENTS.md'])), true);
});

test('application code, deployment configuration, dependencies and assets must build', () => {
  for (const file of [
    'index.html',
    'novelight-client.js',
    'api/stripe-webhook.js',
    'package-lock.json',
    'vercel.json',
    'scripts/check-config.mjs',
    'supabase/migrations/20261012000000_change.sql',
    'assets/cover.png'
  ]) {
    assert.equal(shouldIgnoreProductionBuild(production([file])), false, file);
  }
});

test('mixed commits always build, even if most changed paths are documentation', () => {
  assert.equal(shouldIgnoreProductionBuild(production(['docs/guide.md', 'api/index.js'])), false);
});

test('Preview, non-main and missing environment do not skip builds', () => {
  assert.equal(shouldIgnoreProductionBuild(production(['README.md'], { environment: 'preview' })), false);
  assert.equal(shouldIgnoreProductionBuild(production(['README.md'], { environment: undefined })), false);
  assert.equal(shouldIgnoreProductionBuild(production(['README.md'], { ref: 'feat/test' })), false);
});

test('missing or malformed git diff is build-first (fail-open)', () => {
  for (const paths of [[], undefined, null, [''], ['docs/../api/foo.js'], ['docs\\bad.md']]) {
    assert.equal(shouldIgnoreProductionBuild(production(paths)), false);
  }
});

test('diff reader handles real commits and git parent errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'novelight-build-guard-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid'
      }
    });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'one\n');
  git('add', '.');
  git('commit', '-qm', 'initial docs');
  assert.throws(() => readChangedPaths({ cwd: dir }));
  writeFileSync(join(dir, 'README.md'), 'two\n');
  git('add', '.');
  git('commit', '-qm', 'docs update');
  assert.deepEqual(readChangedPaths({ cwd: dir }), ['README.md']);
  assert.equal(shouldIgnoreProductionBuild(production(readChangedPaths({ cwd: dir }))), true);
});
