// Temporary CI formatter delta probe. REMOVE once the three files match Prettier.
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { format, resolveConfig } from 'prettier';

test('report exact Prettier deltas for AI 02-07-05 files', async () => {
  const paths = [
    'api/_lib/ai/owner-novel-bible-mock-trial.js',
    'tests/ai-novel-bible-chunks.test.mjs',
    'tests/ai-owner-bible-mock-trial.test.mjs'
  ];
  const directory = mkdtempSync(join(tmpdir(), 'ai-020705-format-'));
  try {
    for (const [index, path] of paths.entries()) {
      const original = readFileSync(path, 'utf8');
      const formatted = await format(original, {
        ...(await resolveConfig(path)),
        filepath: path
      });
      const before = join(directory, index + '-before');
      const after = join(directory, index + '-after');
      writeFileSync(before, original);
      writeFileSync(after, formatted);
      const comparison = spawnSync('diff', ['-u', before, after], {
        encoding: 'utf8'
      });
      console.log('AI_020705_FORMAT_START ' + path);
      console.log(comparison.stdout || 'NO_DIFFERENCE');
      console.log('AI_020705_FORMAT_END ' + path);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
