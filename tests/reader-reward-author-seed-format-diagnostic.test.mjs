// Temporary CI-only Prettier output. Remove before OWNER review.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('print exact project formatting for author received-seed files', async () => {
  const files = [
    '../api/_lib/reader-reward/formal-author-growth-reader.js',
    './reader-reward-formal-author-growth.test.mjs'
  ];
  for (const file of files) {
    const path = fileURLToPath(new URL(file, import.meta.url));
    const formatted = await prettier.format(readFileSync(path, 'utf8'), {
      ...((await prettier.resolveConfig(path)) || {}),
      filepath: path
    });
    console.log('SCOUT_AUTHOR_SEED_PRETTIER_JSON:' + JSON.stringify({ file, formatted }));
  }
});
