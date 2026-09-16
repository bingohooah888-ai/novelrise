import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

const target = 'tests/chapter-episode-ordering-contract.test.mjs';

test('print canonical chapter ordering test format', async () => {
  const source = await readFile(target, 'utf8');
  const output = await prettier.format(source, {
    parser: 'babel',
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none'
  });
  console.log('FORMAT_PROBE_START');
  console.log(output);
  console.log('FORMAT_PROBE_END');
});
