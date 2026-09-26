import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { URL } from 'node:url';
import prettier from 'prettier';

test('dump exact Reader Normal contract formatting', async () => {
  const fileUrl = new URL('./scout-badge-reader-normal-31-80-contract.test.mjs', import.meta.url);
  const filePath = fileURLToPath(fileUrl);
  const source = await readFile(fileUrl, 'utf8');
  const config = (await prettier.resolveConfig(filePath)) ?? {};
  const formatted = await prettier.format(source, { ...config, filepath: filePath });
  console.log(`PRETTIER_BEGIN\n${formatted}PRETTIER_END`);
});
