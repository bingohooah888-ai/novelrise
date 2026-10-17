import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('emit canonical reservation protection test formatting', async () => {
  const file = fileURLToPath(
    new URL('./community-hosted-reservation-protection.test.mjs', import.meta.url)
  );
  const options = (await prettier.resolveConfig(file)) ?? {};
  const canonical = await prettier.format(readFileSync(file, 'utf8'), {
    ...options,
    filepath: file
  });
  const encoded = Buffer.from(canonical, 'utf8').toString('base64');
  for (let i = 0; i < encoded.length; i += 180) {
    console.log(
      'RESERVATION_TAG_PRETTIER_CHUNK_' +
        i / 180 +
        '=' +
        encoded.slice(i, i + 180)
    );
  }
});
