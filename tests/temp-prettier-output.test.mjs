import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { format } from 'prettier';

test('print canonical execution-card test formatting', async () => {
  const source = await readFile('tests/execution-turn-card-gate.test.mjs', 'utf8');
  const formatted = await format(source, {
    filepath: 'tests/execution-turn-card-gate.test.mjs'
  });
  console.log('PRETTIER_CANONICAL_BEGIN');
  console.log(formatted);
  console.log('PRETTIER_CANONICAL_END');
});
