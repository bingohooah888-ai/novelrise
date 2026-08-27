import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import * as prettier from 'prettier';

test('emit canonical formatting diff for freshness regression test', async () => {
  const path = 'tests/execution-turn-card-gate.test.mjs';
  const formattedPath = '/tmp/execution-turn-card-gate.formatted.mjs';
  const source = await readFile(path, 'utf8');
  const config = await prettier.resolveConfig(path);
  const formatted = await prettier.format(source, { ...config, filepath: path });
  await writeFile(formattedPath, formatted, 'utf8');
  const diff = spawnSync('diff', ['-u', path, formattedPath], {
    encoding: 'utf8'
  });
  console.log(`PRETTIER_DIFF_START\n${diff.stdout}\nPRETTIER_DIFF_END`);
});
