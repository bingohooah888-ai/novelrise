import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('emit exact Prettier output for Codex gate test', async () => {
  const path = new URL('./codex-first-execution-gate.test.mjs', import.meta.url);
  const source = await readFile(path, 'utf8');
  const formatted = await prettier.format(source, {
    filepath: 'tests/codex-first-execution-gate.test.mjs',
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none'
  });
  const encoded = Buffer.from(formatted, 'utf8').toString('base64');
  console.log(`PRETTIER_OUTPUT_BASE64=${encoded}`);
});
