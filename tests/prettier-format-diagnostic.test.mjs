import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import prettier from 'prettier';

const files = [
  'api/_lib/admin-metrics.js',
  'api/_lib/admin-operations.js',
  'api/admin-dashboard-v2.js'
];

test('emit prettier diffs for admin formatting diagnostics', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'novelight-prettier-'));
  try {
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const config = (await prettier.resolveConfig(file)) ?? {};
      const formatted = await prettier.format(source, {
        ...config,
        filepath: file
      });
      const output = join(dir, file.replaceAll('/', '__'));
      await writeFile(output, formatted, 'utf8');
      const result = spawnSync('diff', ['-u', file, output], {
        encoding: 'utf8'
      });
      console.log(`PRETTIER_DIFF ${file}\n${result.stdout || '(already formatted)'}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
