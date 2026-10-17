import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('emit trusted runner test canonical formatting', async () => {
  const file = fileURLToPath(
    new URL('./community-hosted-trusted-runner-gate.test.mjs', import.meta.url)
  );
  const config = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(readFileSync(file, 'utf8'), {
    ...config,
    filepath: file
  });
  const encoded = Buffer.from(formatted, 'utf8').toString('base64');
  for (let offset = 0; offset < encoded.length; offset += 180) {
    console.log(
      'TRUSTED_RUNNER_FORMAT_' +
        offset / 180 +
        '=' +
        encoded.slice(offset, offset + 180)
    );
  }
});
