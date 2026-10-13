import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('temporary step08 formatting capture (delete in next commit)', async () => {
  for (const file of [
    'api/_lib/november-contest-ranking-cron.js',
    'tests/admin-contest-rankings.test.mjs',
    'tests/november-contest-rank-operator-contract.test.mjs',
    'tests/november-contest-ranking-cron.test.mjs'
  ]) {
    const original = await readFile(file, 'utf8');
    const config = (await prettier.resolveConfig(file)) || {};
    const source = await prettier.format(original, {
      ...config,
      filepath: file
    });
    const parts = encodeURIComponent(source).match(/.{1,800}/gu) || [];
    for (let index = 0; index < parts.length; index += 1) {
      console.log('NOVELIGHT_STEP08_FMT|' + file + '|' + index + '|' + parts[index]);
    }
    console.log('NOVELIGHT_STEP08_END|' + file + '|' + parts.length);
  }
});
