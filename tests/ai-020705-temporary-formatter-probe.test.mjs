import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { format, resolveConfig } from 'prettier';

test('temporary exact Prettier delta for owner model bridge', async () => {
  const path = 'api/_lib/ai/owner-novel-bible-model-bridge.js';
  const original = readFileSync(path, 'utf8');
  const formatted = await format(original, {
    ...(await resolveConfig(path)),
    filepath: path
  });
  const directory = mkdtempSync(join(tmpdir(), 'ai-020705-format-'));
  try {
    const before = join(directory, 'before');
    const after = join(directory, 'after');
    writeFileSync(before, original);
    writeFileSync(after, formatted);
    const comparison = spawnSync('diff', ['-u', before, after], {
      encoding: 'utf8'
    });
    console.log('AI020705_PRETTIER_DIFF_BEGIN');
    console.log(comparison.stdout || 'NO_DIFFERENCE');
    console.log('AI020705_PRETTIER_DIFF_END');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
