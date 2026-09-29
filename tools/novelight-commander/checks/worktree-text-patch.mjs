import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPath, replaceExact } from '../src/worktree-text-patch-bridge.js';

test('worktree text patch accepts repository text paths', () => {
  assert.equal(cleanPath('mypage.html'), 'mypage.html');
  assert.equal(cleanPath('tests/example.test.mjs'), 'tests/example.test.mjs');
});

test('worktree text patch rejects protected paths', () => {
  for (const value of ['../secret', '.git/config', '.github/workflows/ci.yml', '.env', 'dir/.env.production', '/tmp/file']) {
    assert.throws(() => cleanPath(value));
  }
});

test('replaceExact enforces exact replacement count', () => {
  assert.equal(replaceExact('a b a', 'a', 'x', 2), 'x b x');
  assert.throws(() => replaceExact('a b a', 'a', 'x', 1));
});
