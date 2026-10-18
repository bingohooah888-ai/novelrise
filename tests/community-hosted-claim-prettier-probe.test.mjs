import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('print canonically formatted community CLAIM entry tests for correction', async () => {
  const file = fileURLToPath(
    new URL('./community-hosted-claim-entry.test.mjs', import.meta.url)
  );
  const options = (await prettier.resolveConfig(file)) ?? {};
  const output = await prettier.format(readFileSync(file, 'utf8'), {
    ...options,
    filepath: file
  });
  const base64 = Buffer.from(output, 'utf8').toString('base64');
  for (let i = 0; i < base64.length; i += 160) {
    console.log('NOVELIGHT_CLAIM_FORMAT_' + i / 160 + '=' + base64.slice(i, i + 160));
  }
});
