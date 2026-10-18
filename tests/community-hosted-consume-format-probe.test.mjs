import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

// Temporary read-only format probe; deleted before final PR validation.
test('emit canonical consume integrity tests', async () => {
  const file = fileURLToPath(
    new URL('./community-hosted-reservation-coordinator.test.mjs', import.meta.url)
  );
  const options = (await prettier.resolveConfig(file)) ?? {};
  const output = await prettier.format(readFileSync(file, 'utf8'), {
    ...options,
    filepath: file
  });
  const encoded = Buffer.from(output, 'utf8').toString('base64');
  for (let offset = 0; offset < encoded.length; offset += 160) {
    console.log(
      'NOVELIGHT_CONSUME_FORMAT_' +
        offset / 160 +
        '=' +
        encoded.slice(offset, offset + 160)
    );
  }
});
