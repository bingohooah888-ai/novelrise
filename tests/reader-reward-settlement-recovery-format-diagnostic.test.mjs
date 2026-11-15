// Temporary CI Prettier diagnostic. Remove before OWNER review.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('print exact CI formatting for settlement recovery files', async () => {
  const files = [
    '../api/_lib/reader-reward/formal-application-host.js',
    '../api/_lib/reader-reward/formal-settlement-recovery-inspector.js',
    './reader-reward-formal-settlement-recovery-inspector.test.mjs'
  ];
  for (const file of files) {
    const path = fileURLToPath(new URL(file, import.meta.url));
    const formatted = await prettier.format(readFileSync(path, 'utf8'), {
      ...((await prettier.resolveConfig(path)) || {}),
      filepath: path
    });
    console.log('SCOUT_RECOVERY_FORMAT_JSON:' + JSON.stringify({ file, formatted }));
  }
});
