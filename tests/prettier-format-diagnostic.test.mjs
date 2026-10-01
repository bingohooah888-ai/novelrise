import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

const files = [
  'api/_lib/admin-metrics.js',
  'api/_lib/admin-operations.js',
  'api/admin-dashboard-v2.js'
];

test('emit locked prettier output for admin formatting diagnostics', async () => {
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const config = (await prettier.resolveConfig(file)) ?? {};
    const formatted = await prettier.format(source, {
      ...config,
      filepath: file
    });
    console.log(`PRETTIER_FORMAT_BASE64 ${file} ${Buffer.from(formatted).toString('base64')}`);
  }
});
