import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('print canonical edit E2E format', async () => {
  const target = 'tests/e2e/specs/edit-existing-content.js';
  const source = await readFile(target, 'utf8');
  const config = (await prettier.resolveConfig(target)) || {};
  const output = await prettier.format(source, {
    ...config,
    filepath: target
  });
  console.log('E2E_FORMAT_PROBE_BEGIN');
  console.log(output);
  console.log('E2E_FORMAT_PROBE_END');
});
