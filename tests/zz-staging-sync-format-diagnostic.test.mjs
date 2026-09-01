import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('emit canonical Staging sync test formatting', async () => {
  const path = 'tests/staging-migration-sync.test.mjs';
  const source = await readFile(path, 'utf8');
  const config = await prettier.resolveConfig(path);
  const formatted = await prettier.format(source, {
    ...config,
    filepath: path
  });
  console.log('NOVELIGHT_FORMAT_BEGIN');
  console.log(formatted);
  console.log('NOVELIGHT_FORMAT_END');
});
