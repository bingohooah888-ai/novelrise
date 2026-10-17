import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

// Disposable CI-only probe. No external service access or filesystem writes.
test('emit canonical claim/consume test formatting', async () => {
  const file = fileURLToPath(
    new URL('./community-hosted-claim-consume-plan.test.mjs', import.meta.url)
  );
  const config = (await prettier.resolveConfig(file)) ?? {};
  const output = await prettier.format(readFileSync(file, 'utf8'), {
    ...config,
    filepath: file
  });
  const encoded = Buffer.from(output, 'utf8').toString('base64');
  for (let i = 0; i < encoded.length; i += 160) {
    console.log('CLAIM_CONSUME_PRETTIER_CHUNK_' + i / 160 + '=' + encoded.slice(i, i + 160));
  }
});
