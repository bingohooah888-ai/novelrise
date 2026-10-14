// Temporary exact CI Prettier formatter proof. Must be deleted before PR approval.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import prettier from 'prettier';

test('temporary master headful formatter proof 2240', async () => {
  const file = 'tests/nlo-master-headful-readonly-diagnostic.test.mjs';
  const options = (await prettier.resolveConfig(file)) || {};
  const formatted = await prettier.format(readFileSync(file, 'utf8'), { ...options, filepath: file });
  console.log('NLO_PRETTIER_2240_BEGIN:' + Buffer.from(formatted).toString('base64') + ':NLO_PRETTIER_2240_END');
});
