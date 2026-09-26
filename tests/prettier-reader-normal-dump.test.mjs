import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import prettier from 'prettier';

test('dump Reader Normal contract formatting', async () => {
  const source = await readFile(
    new URL('./scout-badge-reader-normal-31-80-contract.test.mjs', import.meta.url),
    'utf8'
  );
  const formatted = await prettier.format(source, {
    parser: 'babel',
    printWidth: 100,
    singleQuote: true,
    trailingComma: 'none'
  });
  console.log(`PRETTIER_BEGIN\n${formatted}PRETTIER_END`);
});
