import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as prettier from 'prettier';

test('diagnostic: dump canonical Prettier output for Badge catalog test', async () => {
  const path = 'tests/chapter49-badge-system-catalog.test.mjs';
  const source = await readFile(path, 'utf8');
  const config = (await prettier.resolveConfig(path)) ?? {};
  const formatted = await prettier.format(source, { ...config, filepath: path });

  console.log('NOVELIGHT_PRETTIER_OUTPUT_START');
  console.log(formatted);
  console.log('NOVELIGHT_PRETTIER_OUTPUT_END');
});
