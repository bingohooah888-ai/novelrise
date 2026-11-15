import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { format, resolveConfig } from 'prettier';

test('temporary exact formatter differences for this draft only', async () => {
  for (const path of [
    'api/_lib/ai/owner-novel-bible-verified-history.js',
    'tests/ai-owner-bible-trial-runtime.test.mjs',
    'tests/ai-owner-bible-verified-history.test.mjs'
  ]) {
    const original = readFileSync(path, 'utf8');
    const formatted = await format(original, {
      ...(await resolveConfig(path)),
      filepath: path
    });
    const temp = mkdtempSync(join(tmpdir(), 'nlo-bible-prettier-'));
    try {
      const before = join(temp, 'before');
      const after = join(temp, 'after');
      writeFileSync(before, original);
      writeFileSync(after, formatted);
      const delta = spawnSync('diff', ['-u', before, after], {
        encoding: 'utf8'
      });
      console.log('AI020705_FORMAT_BEGIN ' + path);
      console.log(delta.stdout || 'NO_DIFFERENCE');
      console.log('AI020705_FORMAT_END ' + path);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
});
