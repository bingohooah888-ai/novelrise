import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

test('NOVELIGHT CI can read owner approval comments for high-risk PRs', () => {
  assert.match(ci, /permissions:\n  contents: read\n  issues: read/);
});
