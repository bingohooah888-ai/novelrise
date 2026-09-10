import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as prettier from 'prettier';

const files = [
  'api/_lib/admin-scout-analytics.js',
  'tests/admin-scout-analytics-api.test.mjs',
  'tests/admin-scout-analytics-page.test.mjs'
];

for (const file of files) {
  test(`PRETTIER_DIAGNOSTIC ${file}`, async () => {
    const source = await readFile(file, 'utf8');
    const formatted = await prettier.format(source, { filepath: file });
    console.log(`PRETTIER_BEGIN ${file}`);
    console.log(formatted);
    console.log(`PRETTIER_END ${file}`);
  });
}
