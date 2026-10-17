import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

test('diagnostic: reveal formatter output for admission test', async () => {
  const url = new URL('../tests/community-hosted-write-admission.test.mjs', import.meta.url);
  const path = fileURLToPath(url);
  const source = readFileSync(path, 'utf8');
  const config = await prettier.resolveConfig(path);
  const formatted = await prettier.format(source, { ...config, filepath: path });
  console.log('NOVELIGHT_PRETTIER_PAYLOAD=' + JSON.stringify(formatted));
});
