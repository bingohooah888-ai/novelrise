import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as prettier from 'prettier';

test('print canonical Prettier output for operator trust contract', async () => {
  const file = resolve(process.cwd(), 'tests/operator-trust-surface.test.mjs');
  const source = readFileSync(file, 'utf8');
  const config = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(source, { ...config, filepath: file });
  console.log('PRETTIER_OUTPUT_START');
  console.log(formatted);
  console.log('PRETTIER_OUTPUT_END');
});
