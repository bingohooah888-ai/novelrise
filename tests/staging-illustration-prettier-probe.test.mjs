import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { format, resolveConfig } from 'prettier';

test('temporary bridge Prettier formatting probe', async () => {
  const path = 'tests/staging-illustration-runner-bridge.test.mjs';
  const source = await readFile(path, 'utf8');
  const formatted = await format(source, {
    ...(await resolveConfig(path)),
    filepath: path
  });
  console.log(
    'BRIDGE_PRETTIER_BASE64=' + Buffer.from(formatted).toString('base64')
  );
});
