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

const shouldSkip = (changedPaths, overrides = {}) =>
  shouldIgnoreProductionBuild({
    environment: 'production',
    ref: 'main',
    changedPaths,
    ...overrides
  });

test('Vercel retains main-only deployments and uses the guard', () => {
  const configPath = new URL('../vercel.json', import.meta.url);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(config.git.deploymentEnabled, { '**': false, main: true });
  assert.equal(config.ignoreCommand, 'node scripts/vercel-ignore-build.mjs');
});

test('documentation, workflow and test-only commits skip Production build', () => {
  assert.equal(shouldSkip(['README.md', 'docs/release-notes.md']), true);
  assert.equal(shouldSkip(['.github/workflows/ci.yml', 'tests/health.test.mjs']), true);
  assert.equal(shouldSkip(['AGENTS.md']), true);
});

test('application, config, dependencies and assets must build', () => {
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
    assert.equal(shouldSkip([file]), false, file);
  }
});

test('mixed commits always build', () => {
  assert.equal(shouldSkip(['docs/guide.md', 'api/index.js']), false);
});

test('Preview, non-main and missing environment never skip builds', () => {
  assert.equal(shouldSkip(['README.md'], { environment: 'preview' }), false);
  assert.equal(shouldSkip(['README.md'], { environment: undefined }), false);
  assert.equal(shouldSkip(['README.md'], { ref: 'feat/test' }), false);
});

test('missing or malformed git diff is build-first', () => {
  const badDiffs = [[], undefined, null, [''], ['docs/../api/foo.js']];
  for (const changedPaths of badDiffs) {
    assert.equal(shouldSkip(changedPaths), false);
  }
  assert.equal(shouldSkip(['docs\\bad.md']), false);
});

test('diff reader handles real commits and missing-parent errors', () => {
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
  assert.equal(shouldSkip(readChangedPaths({ cwd: dir })), true);
});
