// Temporary exact CI formatting check. Deleted before OWNER review.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('print exact CI formatting of reader SEED evidence files', async () => {
  const files = [
    '../api/_lib/reader-reward/formal-reader-seed-evidence.js',
    './reader-reward-formal-reader-seed-evidence.test.mjs'
  ];
  for (const file of files) {
    const path = fileURLToPath(new URL(file, import.meta.url));
    const formatted = await prettier.format(readFileSync(path, 'utf8'), {
      ...((await prettier.resolveConfig(path)) || {}),
      filepath: path
    });
    console.log('SCOUT_READER_SEED_FORMAT_JSON:' + JSON.stringify({ file, formatted }));
  }
});
