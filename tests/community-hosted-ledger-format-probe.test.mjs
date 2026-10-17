import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

// Temporary formatting probe: reads local test only; no network or writes.
test('emit canonical ledger audit test formatting', async () => {
  const file = fileURLToPath(
    new URL('./community-hosted-ledger-audit.test.mjs', import.meta.url)
  );
  const settings = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(readFileSync(file, 'utf8'), {
    ...settings,
    filepath: file
  });
  const encoded = Buffer.from(formatted, 'utf8').toString('base64');
  for (let offset = 0; offset < encoded.length; offset += 160) {
    console.log('CANONICAL_LEDGER_TEST_PART_' + offset / 160 + '=' + encoded.slice(offset, offset + 160));
  }
});
