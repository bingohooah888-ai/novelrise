import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

// Temporary, read-only formatter probe. Removed before final PR validation.
test('emit canonical hosted protection test formatting', async () => {
  for (const [key, name] of [
    ['A', 'community-hosted-reservation-coordinator.test.mjs'],
    ['B', 'community-hosted-github-adapter.test.mjs']
  ]) {
    const file = fileURLToPath(new URL('./' + name, import.meta.url));
    const options = (await prettier.resolveConfig(file)) ?? {};
    const source = await prettier.format(readFileSync(file, 'utf8'), {
      ...options,
      filepath: file
    });
    const encoded = Buffer.from(source, 'utf8').toString('base64');
    for (let offset = 0; offset < encoded.length; offset += 160) {
      console.log(
        'HOSTED_PROTECTION_FORMAT_' + key + '_' +
        offset / 160 + '=' + encoded.slice(offset, offset + 160)
      );
    }
  }
});
