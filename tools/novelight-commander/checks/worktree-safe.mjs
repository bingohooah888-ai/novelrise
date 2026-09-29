import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEditablePath, decodeReplacementContent } from '../src/worktree-safe-bridge.js';

test('worktree bridge accepts ordinary repository-relative paths', () => {
  assert.equal(assertEditablePath('mypage.html'), 'mypage.html');
  assert.equal(assertEditablePath('tests/performance-p1-contracts.test.mjs'), 'tests/performance-p1-contracts.test.mjs');
});

test('worktree bridge rejects control, credential and escaping paths', () => {
  for (const value of ['../secret', '.git/config', '.github/workflows/ci.yml', '.env', 'dir/.env.production', '/tmp/file']) {
    assert.throws(() => assertEditablePath(value));
  }
});

test('replacement content is bounded UTF-8 text', () => {
  const raw = Buffer.from('hello\n日本語\n', 'utf8');
  assert.deepEqual(decodeReplacementContent(raw.toString('base64')), raw);
  assert.throws(() => decodeReplacementContent(Buffer.from([0, 1, 2]).toString('base64')));
  assert.throws(() => decodeReplacementContent(''));
});
