import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as prettier from 'prettier';

const target = 'tests/e2e/production-auth/author-home-smoke.spec.js';

test('dump exact Prettier output for author-home smoke', async () => {
  const source = await readFile(target, 'utf8');
  const config = (await prettier.resolveConfig(target)) ?? {};
  const formatted = await prettier.format(source, {
    ...config,
    filepath: target
  });

  console.log('NOVELIGHT_PRETTIER_DUMP_START');
  console.log(formatted);
  console.log('NOVELIGHT_PRETTIER_DUMP_END');
});
