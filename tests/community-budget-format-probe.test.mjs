import { readFileSync } from 'node:fs';
import test from 'node:test';
import prettier from 'prettier';

test('capture exact Prettier output of two changed budget fixtures', async () => {
  for (const [name, path] of [
    ['EXECUTOR', 'tests/community-hosted-executor-gate.test.mjs'],
    ['PRECOST', 'tests/community-hosted-precost-review-only.test.mjs']
  ]) {
    const config = await prettier.resolveConfig(path);
    const result = await prettier.format(readFileSync(path, 'utf8'), {
      ...config,
      filepath: path
    });
    console.log('BUDGET_' + name + '_BEGIN ' + JSON.stringify(result) + ' BUDGET_' + name + '_END');
  }
});
