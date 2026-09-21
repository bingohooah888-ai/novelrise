import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { format, resolveConfig } from 'prettier';

const files = [
  'api/_lib/admin-scout-analytics.js',
  'api/_lib/admin-scout-progression.js'
];

test('emit configured SCOUT analytics formatting', async () => {
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    const config = (await resolveConfig(path)) ?? {};
    const formatted = await format(source, { ...config, filepath: path });
    const encoded = Buffer.from(formatted, 'utf8').toString('base64');
    console.log(`SCOUT_PRETTIER:${path}:${encoded}`);
  }
});
