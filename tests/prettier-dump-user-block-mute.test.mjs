import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

test('dump canonical user block mute contract formatting', async () => {
  const url = new URL('./user-block-mute-contract.test.mjs', import.meta.url);
  const input = await readFile(url, 'utf8');
  const formatted = await prettier.format(input, {
    ...(await prettier.resolveConfig(fileURLToPath(url))),
    filepath: fileURLToPath(url)
  });
  console.log('PRETTIER_DUMP_START');
  console.log(formatted);
  console.log('PRETTIER_DUMP_END');
});
