import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

test('format review: print canonical hosted preprovision test only', async () => {
  const path = fileURLToPath(
    new URL('../tests/community-hosted-preprovision.test.mjs', import.meta.url)
  );
  const source = readFileSync(path, 'utf8');
  const config = await prettier.resolveConfig(path);
  const formatted = await prettier.format(source, {
    ...config,
    filepath: path
  });
  console.log('NOVELIGHT_PREFLIGHT_FORMAT=' + JSON.stringify(formatted));
});
