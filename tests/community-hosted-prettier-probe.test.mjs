import { readFileSync } from 'node:fs';
import test from 'node:test';
import prettier from 'prettier';

test('capture exact Prettier output for community watchdog test', async () => {
  const path = 'tests/community-hosted-watchdog-registration.test.mjs';
  const source = readFileSync(path, 'utf8');
  const config = await prettier.resolveConfig(path);
  const result = await prettier.format(source, {
    ...config,
    filepath: path
  });
  console.log('PRETTIER_JSON_START ' + JSON.stringify(result) + ' PRETTIER_JSON_END');
});
