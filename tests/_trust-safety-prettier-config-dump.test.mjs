import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

const files = [
  'api/_lib/admin-trust-safety.js',
  'api/admin-trust-safety.js',
  'tests/admin-trust-safety-api.test.mjs',
  'tests/admin-trust-safety-page.test.mjs',
  'tests/trust-safety-migration-contract.test.mjs'
];

test('emit config-aware Trust & Safety prettier output', async () => {
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const config = (await prettier.resolveConfig(file)) ?? {};
    const formatted = await prettier.format(source, { ...config, filepath: file });
    const encoded = Buffer.from(formatted, 'utf8').toString('base64');
    console.log(`TRUST_PRETTIER_BASE64 ${file} ${encoded}`);
  }
});
