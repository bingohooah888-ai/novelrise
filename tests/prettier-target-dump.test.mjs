import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { format } from 'prettier';

const targets = [
  'tests/scout-badge-zoom-csp-contract.test.mjs',
  'tests/thumbnail-runtime-delivery-contract.test.mjs'
];

test('dump exact Prettier output for the remaining targets', async () => {
  for (const target of targets) {
    const source = await readFile(target, 'utf8');
    const formatted = await format(source, { filepath: target });
    console.log(`PRETTIER_BEGIN ${target}\n${formatted}PRETTIER_END ${target}`);
  }
});
