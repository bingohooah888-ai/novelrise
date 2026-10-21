import { readFileSync } from 'node:fs';
import test from 'node:test';
import prettier from 'prettier';

test('capture exact protected-readiness formatting', async () => {
  for (const [key, path] of [
    ['WORKFLOW', '.github/workflows/community-hosted-executor.yml'],
    ['TEST', 'tests/community-hosted-protected-readiness.test.mjs']
  ]) {
    const original = readFileSync(path, 'utf8');
    const config = await prettier.resolveConfig(path);
    const formatted = await prettier.format(original, {
      ...config,
      filepath: path
    });
    console.log('PROBE_' + key + '_BEGIN ' + JSON.stringify(formatted) + ' PROBE_' + key + '_END');
  }
});
