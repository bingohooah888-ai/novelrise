import { readFileSync } from 'node:fs';
import test from 'node:test';
import prettier from 'prettier';

test('record exact Prettier output for one synthetic test fixture', async () => {
  const path = 'tests/community-hosted-watchdog-registration.test.mjs';
  const source = readFileSync(path, 'utf8');
  const options = await prettier.resolveConfig(path);
  const result = await prettier.format(source, {
    ...options,
    filepath: path
  });
  console.log('PRETTIER_JSON_START ' + JSON.stringify(result) + ' PRETTIER_JSON_END');
});
