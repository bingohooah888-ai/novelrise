import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import prettier from 'prettier';

const root = resolve(import.meta.dirname, '..');
const files = [
  'api/_lib/admin-trust-safety.js',
  'api/admin-trust-safety.js',
  'tests/admin-trust-safety-api.test.mjs',
  'tests/admin-trust-safety-page.test.mjs',
  'tests/trust-safety-migration-contract.test.mjs'
];

test('emit canonical prettier output for Trust & Safety files', async () => {
  for (const file of files) {
    const source = readFileSync(resolve(root, file), 'utf8');
    const formatted = await prettier.format(source, { filepath: file });
    console.log(`TRUST_FORMAT_BEGIN ${file}`);
    console.log(Buffer.from(formatted, 'utf8').toString('base64'));
    console.log(`TRUST_FORMAT_END ${file}`);
  }
});
