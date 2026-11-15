// Temporary exact CI formatting diagnostic; remove before OWNER review.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('print exact CI formatting for reader seed XP UI test', async () => {
  const file = './reader-reward-formal-seed-xp-ui.test.mjs';
  const path = fileURLToPath(new URL(file, import.meta.url));
  const formatted = await prettier.format(readFileSync(path, 'utf8'), {
    ...((await prettier.resolveConfig(path)) || {}),
    filepath: path
  });
  console.log('SCOUT_READER_SEED_UI_FORMAT_JSON:' + JSON.stringify({ file, formatted }));
});
