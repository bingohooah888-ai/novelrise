import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { format, resolveConfig } from 'prettier';

test('temporary formatter delta for AI checkpoint implementation', async () => {
  for (const path of [
    'api/_lib/ai/owner-novel-bible-checkpoint.js',
    'api/_lib/ai/owner-novel-bible-model-bridge.js',
    'tests/ai-owner-bible-checkpoint.test.mjs'
  ]) {
    const original = readFileSync(path, 'utf8');
    const formatted = await format(original, {
      ...(await resolveConfig(path)),
      filepath: path
    });
    const directory = mkdtempSync(join(tmpdir(), 'ai-checkpoint-format-'));
    try {
      const before = join(directory, 'before');
      const after = join(directory, 'after');
      writeFileSync(before, original);
      writeFileSync(after, formatted);
      const result = spawnSync('diff', ['-u', before, after], {
        encoding: 'utf8'
      });
      console.log('AI_CHECKPOINT_FORMAT_BEGIN ' + path);
      console.log(result.stdout || 'NO_DIFFERENCE');
      console.log('AI_CHECKPOINT_FORMAT_END ' + path);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
