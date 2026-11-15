// Temporary exact CI Prettier diagnostic; remove before merge.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('emit CI formatting for badge history files', async () => {
  const paths = [
    '../api/_lib/reader-reward/formal-badge-history-inspector.js',
    './reader-reward-formal-badge-history-inspector.test.mjs'
  ];
  for (const path of paths) {
    const file = fileURLToPath(new URL(path, import.meta.url));
    const options = (await prettier.resolveConfig(file)) || {};
    const formatted = await prettier.format(readFileSync(file, 'utf8'), {
      ...options,
      filepath: file
    });
    console.log('SCOUT_HISTORY_FORMAT_JSON:' + JSON.stringify({ path, formatted }));
  }
});
