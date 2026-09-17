import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('print canonical safe prose contract formatting', async () => {
  const path = new URL('./safe-prose-markup-contract.test.mjs', import.meta.url);
  const source = await readFile(path, 'utf8');
  const config = await prettier.resolveConfig(path.pathname);
  const formatted = await prettier.format(source, {
    ...config,
    filepath: path.pathname
  });
  console.log('SAFE_PROSE_FORMAT_START');
  console.log(formatted);
  console.log('SAFE_PROSE_FORMAT_END');
});
