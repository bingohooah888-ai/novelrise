import test from 'node:test';
import { readFileSync } from 'node:fs';
import prettier from 'prettier';

test('temporary exact-format probe for trusted browser runner', async () => {
  for (const path of [
    'tests/community-browser-readonly.test.mjs',
    'tests/e2e/staging/community-gated-readonly.spec.js'
  ]) {
    const raw = readFileSync(path, 'utf8');
    const config = (await prettier.resolveConfig(path)) || {};
    const formatted = await prettier.format(raw, { ...config, filepath: path });
    console.log('NL_READONLY_FORMAT ' + JSON.stringify({
      path,
      base64: Buffer.from(formatted, 'utf8').toString('base64')
    }));
  }
});
