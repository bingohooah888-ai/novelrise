// Temporary exact-format diagnostic; remove before any merge.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('format the author Rank module with repository Prettier rules', async () => {
  const relative = '../api/_lib/reader-reward/formal-author-growth-reader.js';
  const target = fileURLToPath(new URL(relative, import.meta.url));
  const options = (await prettier.resolveConfig(target)) || {};
  const formatted = await prettier.format(readFileSync(target, 'utf8'), {
    ...options,
    filepath: target
  });
  console.log('AUTHOR_RANK_FORMAT_JSON:' + JSON.stringify({ formatted }));
});
