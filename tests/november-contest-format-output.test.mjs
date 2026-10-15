// Temporary one-time formatter witness. Remove this file before merging.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import prettier from 'prettier';

test('emit exact Prettier formatting for three contest test files', async () => {
  for (const path of [
    'tests/november-contest-stage10-12-safety-contract.test.mjs',
    'tests/november-contest-start-plan.test.mjs',
    'tests/november-contest-start-release.test.mjs'
  ]) {
    const original = readFileSync(path, 'utf8');
    const config = (await prettier.resolveConfig(path)) || {};
    const content = await prettier.format(original, {
      ...config,
      filepath: path
    });
    console.log('CONTEST_FORMAT_JSON ' + JSON.stringify({ path, content }));
  }
});
