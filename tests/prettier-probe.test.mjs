import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('prints the exact formatted novel series contract', async () => {
  const source = await readFile('tests/novel-series-contract.test.mjs', 'utf8');
  const formatted = await prettier.format(source, {
    filepath: 'tests/novel-series-contract.test.mjs'
  });
  console.log(`__PRETTIER_START__\n${formatted}__PRETTIER_END__`);
});
