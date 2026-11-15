// Temporary formatter diagnostic for two changes. Remove before merge.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('temporary canonical formatting output', async () => {
  const paths = [
    '../api/_lib/reader-reward/formal-scout-overview-reader.js',
    './reader-reward-formal-scout-overview.test.mjs'
  ];
  for (const relative of paths) {
    const target = fileURLToPath(new URL(relative, import.meta.url));
    const options = (await prettier.resolveConfig(target)) || {};
    const formatted = await prettier.format(readFileSync(target, 'utf8'), {
      ...options,
      filepath: target
    });
    console.log('SCOUT_FORMAT_JSON:' + JSON.stringify({
      path: relative,
      formatted
    }));
  }
});
