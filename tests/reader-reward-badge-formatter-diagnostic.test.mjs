// Temporary exact CI Prettier diagnostic; delete before main approval.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('emit exact checked formatting for badge catalog additions', async () => {
  const relativePaths = [
    '../api/_lib/reader-reward/formal-badge-catalog-inspector.js',
    './reader-reward-formal-badge-catalog-inspector.test.mjs'
  ];
  for (const path of relativePaths) {
    const file = fileURLToPath(new URL(path, import.meta.url));
    const options = (await prettier.resolveConfig(file)) || {};
    const formatted = await prettier.format(readFileSync(file, 'utf8'), {
      ...options,
      filepath: file
    });
    console.log('SCOUT_BADGE_FORMAT_JSON:' + JSON.stringify({ path, formatted }));
  }
});
