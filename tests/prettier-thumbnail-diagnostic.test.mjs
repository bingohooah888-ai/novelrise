import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('print exact prettier output for thumbnail regression test', async () => {
  const source = await readFile(
    new URL('./chapter40-official-thumbnail-assets-v1.test.mjs', import.meta.url),
    'utf8'
  );
  const formatted = await prettier.format(source, {
    filepath: 'tests/chapter40-official-thumbnail-assets-v1.test.mjs',
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none'
  });
  if (source !== formatted) {
    throw new Error(`PRETTIER_OUTPUT_START\n${formatted}\nPRETTIER_OUTPUT_END`);
  }
});
