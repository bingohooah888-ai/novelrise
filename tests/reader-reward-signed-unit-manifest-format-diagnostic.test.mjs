// Temporary exact CI Prettier diagnostic; delete before OWNER review.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('print CI formatting for signed unit manifest files', async () => {
  const files = [
    '../api/_lib/reader-reward/formal-beta-unit-signed-manifest.js',
    './reader-reward-formal-beta-unit-signed-manifest.test.mjs'
  ];
  for (const file of files) {
    const path = fileURLToPath(new URL(file, import.meta.url));
    const formatted = await prettier.format(readFileSync(path, 'utf8'), {
      ...((await prettier.resolveConfig(path)) || {}),
      filepath: path
    });
    console.log('SCOUT_SIGNED_UNIT_FORMAT_JSON:' + JSON.stringify({ file, formatted }));
  }
});
