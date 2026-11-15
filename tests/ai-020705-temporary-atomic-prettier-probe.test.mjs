import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { format, resolveConfig } from 'prettier';

test('temporary exact formatting diagnostics for atomic checkpoint', async () => {
  for (const path of [
    'api/_lib/ai/owner-novel-bible-checkpoint.js',
    'tests/ai-owner-bible-checkpoint.test.mjs'
  ]) {
    const original = readFileSync(path, 'utf8');
    const formatted = await format(original, {
      ...(await resolveConfig(path)),
      filepath: path
    });
    const dir = mkdtempSync(join(tmpdir(), 'ai-checkpoint-fmt-'));
    try {
      const before = join(dir, 'before');
      const after = join(dir, 'after');
      writeFileSync(before, original);
      writeFileSync(after, formatted);
      const output = spawnSync('diff', ['-u', before, after], {
        encoding: 'utf8'
      }).stdout;
      console.log('ATOMIC_FORMAT_FILE ' + path + ' START');
      console.log(output || 'NO_DIFFERENCE');
      console.log('ATOMIC_FORMAT_FILE ' + path + ' END');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
