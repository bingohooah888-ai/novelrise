import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { format, resolveConfig } from 'prettier';

test('temporary cross-page review formatter diff; remove before final', async () => {
  const path = 'tests/ai-owner-bible-review-repository.test.mjs';
  const original = readFileSync(path, 'utf8');
  const formatted = await format(original, {
    ...(await resolveConfig(path)),
    filepath: path
  });
  const directory = mkdtempSync(join(tmpdir(), 'ai020705-cross-pagefmt-'));
  try {
    const before = join(directory, 'before');
    const after = join(directory, 'after');
    writeFileSync(before, original);
    writeFileSync(after, formatted);
    const result = spawnSync('diff', ['-u', before, after], {
      encoding: 'utf8'
    });
    console.log('CROSS_PAGE_FORMAT_BEGIN');
    console.log(result.stdout || 'NO_DIFFERENCE');
    console.log('CROSS_PAGE_FORMAT_END');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
