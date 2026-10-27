import { readFile } from 'node:fs/promises';
import test from 'node:test';

import prettier from 'prettier';

test('temporary Novel Bible studio formatting diagnostic', async () => {
  const file = 'tests/ai-owner-bible-studio.test.mjs';
  const source = await readFile(file, 'utf8');
  const options = (await prettier.resolveConfig(file)) ?? {};
  const output = await prettier.format(source, { ...options, filepath: file });
  console.log('NOVELIGHT_FORMAT_STUDIO_BEGIN');
  console.log(output);
  console.log('NOVELIGHT_FORMAT_STUDIO_END');
});
