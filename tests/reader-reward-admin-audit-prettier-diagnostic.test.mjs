// Temporary exact project Prettier diagnostic; remove before OWNER review.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('print the exact CI formatting for admin audit integration test', async () => {
  const file = './reader-reward-formal-admin-reconciliation-panel.test.mjs';
  const path = fileURLToPath(new URL(file, import.meta.url));
  const formatted = await prettier.format(readFileSync(path, 'utf8'), {
    ...((await prettier.resolveConfig(path)) || {}),
    filepath: path
  });
  console.log('SCOUT_ADMIN_AUDIT_PRETTIER_JSON:' + JSON.stringify({ file, formatted }));
});
