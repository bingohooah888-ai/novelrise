import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

// Temporary formatting probe. No external access and no write side effects.
test('emit canonical Prettier output for review', async () => {
  const file = fileURLToPath(
    new URL('./community-hosted-precost-admission.test.mjs', import.meta.url)
  );
  const settings = (await prettier.resolveConfig(file)) ?? {};
  const canonical = await prettier.format(readFileSync(file, 'utf8'), {
    ...settings,
    filepath: file
  });
  const encoded = Buffer.from(canonical, 'utf8').toString('base64');
  for (let offset = 0; offset < encoded.length; offset += 160) {
    const position = offset / 160;
    console.log('PRETTIER_CANONICAL_PART_' + position + '=' + encoded.slice(offset, offset + 160));
  }
});
