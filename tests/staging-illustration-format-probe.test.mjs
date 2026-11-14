import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { format, resolveConfig } from 'prettier';

test('temporary format probe for reviewed PNG regression test', async () => {
  const path = 'tests/staging-illustration-pinned-sql.test.mjs';
  const source = await readFile(path, 'utf8');
  const formatted = await format(source, { ...(await resolveConfig(path)), filepath: path });
  console.log('NOVELIGHT_PRETTIER_BASE64=' + Buffer.from(formatted).toString('base64'));
});
