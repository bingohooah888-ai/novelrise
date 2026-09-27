import { readFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import test from 'node:test';

test('print exact Prettier output for LIGHT SEED contract test', async () => {
  const path = 'tests/light-seed-auto-tier.test.mjs';
  const source = await readFile(path, 'utf8');
  const config = (await resolveConfig(path)) || {};
  const output = await format(source, { ...config, filepath: path });
  console.log('FORMAT_PROBE_START');
  console.log(output);
  console.log('FORMAT_PROBE_END');
});
