// Temporary diagnostic: exact project Prettier output. Remove before OWNER review.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('print exact Wallet cohort formatting in CI', async () => {
  const files = [
    '../api/_lib/reader-reward/formal-wallet-cohort-inspector.js',
    './reader-reward-formal-wallet-cohort-inspector.test.mjs'
  ];
  for (const file of files) {
    const path = fileURLToPath(new URL(file, import.meta.url));
    const formatted = await prettier.format(readFileSync(path, 'utf8'), {
      ...((await prettier.resolveConfig(path)) || {}),
      filepath: path
    });
    console.log('SCOUT_WALLET_COHORT_FORMAT_JSON:' + JSON.stringify({ file, formatted }));
  }
});
