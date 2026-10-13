// Temporary CI-only format proof: removed in final commit.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import prettier from 'prettier';

test('temporary NLO MASTER Prettier proof 2221', async () => {
  const file = 'tests/nlo-master-auto-sync-retry-policy.test.mjs';
  const source = readFileSync(file, 'utf8');
  const options = (await prettier.resolveConfig(file)) || {};
  const result = await prettier.format(source, { ...options, filepath: file });
  console.log('NLO_PRETTIER_2221_BEGIN:' + Buffer.from(result).toString('base64') + ':NLO_PRETTIER_2221_END');
});
