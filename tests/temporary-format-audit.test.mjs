import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { format, resolveConfig } from 'prettier';

test('temporary formatting audit', async () => {
  const paths = [
    'tests/november-contest-reader-browser.test.mjs',
    'tests/november-contest-reader-ready.test.mjs'
  ];
  for (const path of paths) {
    const current = await readFile(path, 'utf8');
    const settings = (await resolveConfig(path)) || {};
    const formatted = await format(current, { ...settings, filepath: path });
    if (current !== formatted) {
      console.log('NOVELIGHT_FORMAT_JSON ' + JSON.stringify({ path, formatted }));
    }
  }
});
