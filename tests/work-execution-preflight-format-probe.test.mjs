import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { format, resolveConfig } from 'prettier';

const target = 'tests/work-execution-preflight-contract.test.mjs';

test('print expected Prettier output', async () => {
  const source = await readFile(target, 'utf8');
  const config = (await resolveConfig(target)) ?? {};
  const output = await format(source, { ...config, filepath: target });

  console.log('FORMAT_PROBE_START');
  console.log(output);
  console.log('FORMAT_PROBE_END');
});
