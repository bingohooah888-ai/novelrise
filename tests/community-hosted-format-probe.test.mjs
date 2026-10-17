import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

// Temporary local-only canonical formatting probe; deleted before merge.
test('emit scoped test formatting without writing source', async () => {
  for (const [key, name] of [
    ['A', 'community-hosted-reservation-coordinator.test.mjs'],
    ['B', 'community-hosted-github-adapter.test.mjs']
  ]) {
    const file = fileURLToPath(new URL('./' + name, import.meta.url));
    const config = (await prettier.resolveConfig(file)) ?? {};
    const formatted = await prettier.format(readFileSync(file, 'utf8'), {
      ...config,
      filepath: file
    });
    const encoded = Buffer.from(formatted, 'utf8').toString('base64');
    for (let index = 0; index < encoded.length; index += 180) {
      console.log(
        'COMMUNITY_PROBE_' +
          key +
          '_' +
          index / 180 +
          '=' +
          encoded.slice(index, index + 180)
      );
    }
  }
});
