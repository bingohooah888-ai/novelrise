import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('dump chapter contract prettier output', async () => {
  const source = await readFile(
    'tests/chapter-episode-ordering-contract.test.mjs',
    'utf8'
  );
  const formatted = await prettier.format(source, {
    parser: 'babel',
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none'
  });
  console.log('PRETTIER_DUMP_BEGIN');
  console.log(formatted);
  console.log('PRETTIER_DUMP_END');
});
