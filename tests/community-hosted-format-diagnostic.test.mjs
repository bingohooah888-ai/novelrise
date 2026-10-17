import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

test('emit canonical formatter files for review', async () => {
  for (const relative of [
    '../tests/community-hosted-branch-manager.test.mjs',
    '../tests/e2e/staging/community-hosted-auth-write.spec.js'
  ]) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    const raw = readFileSync(path, 'utf8');
    const config = await prettier.resolveConfig(path);
    const formatted = await prettier.format(raw, {
      ...config,
      filepath: path
    });
    console.log('NOVELIGHT_FORMAT_JSON=' + JSON.stringify({
      path: relative,
      content: formatted
    }));
  }
});
