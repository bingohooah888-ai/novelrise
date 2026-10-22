import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

test('diagnostic print exact prettier output for draft formatting repair', async () => {
  const path = fileURLToPath(
    new URL('./community-hosted-preapproval-audit.test.mjs', import.meta.url)
  );
  const raw = await readFile(path, 'utf8');
  const config = (await prettier.resolveConfig(path)) ?? {};
  const formatted = await prettier.format(raw, { ...config, filepath: path });
  console.log('PREAPPROVAL_PRETTIER_JSON=' + JSON.stringify(formatted));
});
