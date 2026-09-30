import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

test('PR branch sync is fixed to open same-repo PRs targeting main', async () => {
  const source = await read('src/pr-branch-sync-bridge.js');
  assert.match(source, /pull[?][.]state !== 'open'/);
  assert.match(source, /pull[?][.]base[?][.]ref !== 'main'/);
  assert.match(source, /pull[?][.]head[?][.]repo[?][.]full_name/);
  assert.match(source, /CHAT_PRODUCTION_APPROVED/);
  assert.match(source, /Remote PR branch moved/);
});

test('PR branch sync only merges current main and fast-forwards the existing head branch', async () => {
  const source = await read('src/pr-branch-sync-bridge.js');
  assert.match(source, /\['fetch', '--no-tags', 'origin', 'main'\]/);
  assert.match(source, /'merge',\n\s*'--no-ff',\n\s*'--no-edit'/);
  assert.match(source, /HEAD:refs\/heads\//);
  assert.match(source, /push_mode: fast_forward_merge_commit/);
  assert.doesNotMatch(source, /--force/);
});

test('PR branch sync uses an isolated worktree and removes it after execution', async () => {
  const source = await read('src/pr-branch-sync-bridge.js');
  assert.match(source, /worktree', 'add', '--detach'/);
  assert.match(source, /worktree', 'remove', '--force'/);
  assert.match(source, /Fresh PR sync worktree is unexpectedly dirty/);
});
