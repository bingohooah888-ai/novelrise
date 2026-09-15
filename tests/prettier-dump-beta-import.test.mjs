import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('print canonical beta import test formatting', () => {
  const output = execFileSync(
    'node_modules/.bin/prettier',
    ['tests/beta-episode-import.test.mjs'],
    { encoding: 'utf8' }
  );
  console.log(`PRETTIER_B64:${Buffer.from(output).toString('base64')}`);
  assert.fail('diagnostic only');
});
