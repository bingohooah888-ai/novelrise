// TEMPORARY CI formatter proof, must be removed before review.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import prettier from 'prettier';

test('temporary exact formatter proof 2237', async () => {
  const file = 'tests/nlo-master-project-render-telemetry.test.mjs';
  const options = (await prettier.resolveConfig(file)) || {};
  const source = readFileSync(file, 'utf8');
  const formatted = await prettier.format(source, { ...options, filepath: file });
  console.log('NLO_PRETTIER_2237_BEGIN:' + Buffer.from(formatted, 'utf8').toString('base64') + ':NLO_PRETTIER_2237_END');
});
