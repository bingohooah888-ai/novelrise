import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('prints canonical scheduled publication test formatting', async () => {
  const source = await readFile(
    'tests/episode-scheduled-publication.test.mjs',
    'utf8'
  );
  const formatted = await prettier.format(source, { parser: 'babel' });
  console.log(
    `PRETTIER_SCHEDULED_PUBLICATION_BASE64=${Buffer.from(formatted).toString('base64')}`
  );
});
