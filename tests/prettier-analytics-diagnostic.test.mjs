import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('temporary analytics Prettier diagnostic', async () => {
  const path = 'tests/e2e/specs/analytics-visual-trends.spec.js';
  const source = await readFile(path, 'utf8');
  const formatted = await prettier.format(source, { filepath: path });
  throw new Error(`PRETTIER_OUTPUT_BEGIN\n${formatted}\nPRETTIER_OUTPUT_END`);
});
