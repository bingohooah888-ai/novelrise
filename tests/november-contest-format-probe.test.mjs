import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

test('temporary formatter output for the scope-locked query-route test', async () => {
  const target = fileURLToPath(new URL('./november-contest-query-route-readonly-preflight.test.mjs', import.meta.url));
  const options = await prettier.resolveConfig(target);
  const current = await readFile(target, 'utf8');
  const formatted = await prettier.format(current, { ...options, filepath: target });
  console.log('PRETTIER_OUTPUT_JSON=' + JSON.stringify(formatted));
});
