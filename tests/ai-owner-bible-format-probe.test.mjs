import { readFile } from 'node:fs/promises';
import test from 'node:test';

import prettier from 'prettier';

test('temporary formatting diagnostic for the two owner-only AI tests', async () => {
  const paths = [
    'tests/ai-owner-bible-api.test.mjs',
    'tests/ai-owner-bible-panel.test.mjs'
  ];
  for (const file of paths) {
    const source = await readFile(file, 'utf8');
    const options = (await prettier.resolveConfig(file)) ?? {};
    const output = await prettier.format(source, { ...options, filepath: file });
    console.log('NOVELIGHT_FORMAT_BEGIN_' + file);
    console.log(output);
    console.log('NOVELIGHT_FORMAT_END_' + file);
  }
});
