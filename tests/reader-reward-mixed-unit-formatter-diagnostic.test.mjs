// Temporary exact CI Prettier diagnostic. Delete before OWNER review.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('emit exact CI formatting for mixed beta Point unit changes', async () => {
  const paths = [
    '../api/_lib/reader-reward/formal-cutover-offline.js',
    './reader-reward-formal-cutover-mixed-units.test.mjs'
  ];
  for (const path of paths) {
    const file = fileURLToPath(new URL(path, import.meta.url));
    const options = (await prettier.resolveConfig(file)) || {};
    const formatted = await prettier.format(readFileSync(file, 'utf8'), {
      ...options,
      filepath: file
    });
    console.log('SCOUT_MIXED_FORMAT_JSON:' + JSON.stringify({ path, formatted }));
  }
});
