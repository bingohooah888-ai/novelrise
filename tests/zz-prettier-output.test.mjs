import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as prettier from 'prettier';

test('emit canonical formatting for freshness regression test', async () => {
  const path = 'tests/execution-turn-card-gate.test.mjs';
  const source = await readFile(path, 'utf8');
  const formatted = await prettier.format(source, { filepath: path });
  console.log(`PRETTIER_OUTPUT_BASE64:${Buffer.from(formatted).toString('base64')}`);
});
