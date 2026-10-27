import { readFile } from 'node:fs/promises';
import test from 'node:test';

import prettier from 'prettier';

test('temporarily print the canonical owner preview test format', async () => {
  const file = 'tests/ai-owner-preview.test.mjs';
  const input = await readFile(file, 'utf8');
  const config = (await prettier.resolveConfig(file)) ?? {};
  const output = await prettier.format(input, { ...config, filepath: file });
  console.log('NOVELIGHT_FORMAT_BEGIN');
  console.log(output);
  console.log('NOVELIGHT_FORMAT_END');
});
