import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import prettier from 'prettier';

test('emit exact Prettier diff for Codex gate test', async () => {
  const url = new URL('./codex-first-execution-gate.test.mjs', import.meta.url);
  const path = fileURLToPath(url);
  const source = await readFile(path, 'utf8');
  const formatted = await prettier.format(source, {
    filepath: 'tests/codex-first-execution-gate.test.mjs',
    singleQuote: true,
    semi: true,
    tabWidth: 2,
    trailingComma: 'none'
  });
  const target = '/tmp/codex-first-execution-gate.prettier.mjs';
  await writeFile(target, formatted, 'utf8');
  const result = spawnSync('git', ['diff', '--no-index', '--', path, target], {
    encoding: 'utf8'
  });
  console.log(`PRETTIER_DIFF_START\n${result.stdout}PRETTIER_DIFF_END`);
});
