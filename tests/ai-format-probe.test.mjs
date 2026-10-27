import { readFile } from 'node:fs/promises';
import test from 'node:test';

import prettier from 'prettier';

test('diagnostic formatting of author canon test only', async () => {
  const file = 'tests/ai-supabase-store.test.mjs';
  const source = await readFile(file, 'utf8');
  const options = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(source, { ...options, filepath: file });
  const index = formatted.indexOf('function ownerCanonClients(');
  if (source !== formatted && index !== -1) {
    console.log('NOVELIGHT_PRETTIER_EXPECTED_BEGIN');
    console.log(formatted.slice(index));
    console.log('NOVELIGHT_PRETTIER_EXPECTED_END');
  }
});
