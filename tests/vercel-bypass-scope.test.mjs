import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const configPath = new URL(
  '../tests/e2e/playwright.production-auth.config.mjs',
  import.meta.url
);
const setupPath = new URL(
  '../tests/e2e/production-auth/vercel-bypass-global-setup.mjs',
  import.meta.url
);

test('Vercel automation bypass is converted to a host-scoped cookie', async () => {
  const [config, setup] = await Promise.all([
    readFile(configPath, 'utf8'),
    readFile(setupPath, 'utf8')
  ]);

  assert.doesNotMatch(config, /extraHTTPHeaders/);
  assert.match(config, /storageState:\s*bypassStorageState/);
  assert.match(setup, /x-vercel-protection-bypass/);
  assert.match(setup, /x-vercel-set-bypass-cookie/);
  assert.match(setup, /cookie\.domain === target\.hostname/);
});
