import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { format, resolveConfig } from 'prettier';

test('print configured canonical execution-card test formatting', async () => {
  const filepath = 'tests/execution-turn-card-gate.test.mjs';
  const source = await readFile(filepath, 'utf8');
  const config = (await resolveConfig(filepath)) || {};
  const formatted = await format(source, { ...config, filepath });
  console.log('PRETTIER_CONFIGURED_BEGIN');
  console.log(formatted);
  console.log('PRETTIER_CONFIGURED_END');
});
