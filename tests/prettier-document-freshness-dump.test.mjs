import { readFileSync } from 'node:fs';
import test from 'node:test';

import { format } from 'prettier';

test('emit exact formatting for document freshness regression test', async () => {
  const path = new URL('./document-freshness-gate.test.mjs', import.meta.url);
  const source = readFileSync(path, 'utf8');
  const formatted = await format(source, {
    filepath: 'tests/document-freshness-gate.test.mjs',
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none'
  });
  console.log('NOVELIGHT_PRETTIER_DUMP_BEGIN');
  console.log(Buffer.from(formatted, 'utf8').toString('base64'));
  console.log('NOVELIGHT_PRETTIER_DUMP_END');
});
