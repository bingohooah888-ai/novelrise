import { readFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('temporary Prettier output for Staging history test', async () => {
  const file = fileURLToPath(
    new URL('staging-migration-observed.test.mjs', import.meta.url)
  );
  const source = await readFile(file, 'utf8');
  const config = await resolveConfig(file);
  const formatted = await format(source, {
    ...config,
    filepath: file
  });
  console.log('STAGING_PRETTIER_B64=' + Buffer.from(formatted).toString('base64'));
});
