import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('print canonical formatting for interaction settings contract', async () => {
  const source = await readFile('tests/per-work-interaction-settings.test.mjs', 'utf8');
  const formatted = await prettier.format(source, {
    filepath: 'tests/per-work-interaction-settings.test.mjs',
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none'
  });
  console.log('PRETTIER_OUTPUT_START');
  console.log(formatted);
  console.log('PRETTIER_OUTPUT_END');
});
