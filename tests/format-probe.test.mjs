import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as prettier from 'prettier';

test('format probe', async () => {
  const source = await readFile(
    new URL('./trusted-public-impressions.test.mjs', import.meta.url),
    'utf8'
  );
  const formatted = await prettier.format(source, {
    parser: 'babel',
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none'
  });
  console.log(`FORMAT_PROBE_BEGIN\n${formatted}FORMAT_PROBE_END`);
});
