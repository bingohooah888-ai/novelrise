import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { format, resolveConfig } from 'prettier';

test('temporary exact review-pages Prettier diff; remove before final', async () => {
  const path = 'tests/ai-owner-bible-review-actions.test.mjs';
  const original = readFileSync(path, 'utf8');
  const formatted = await format(original, {
    ...(await resolveConfig(path)),
    filepath: path
  });
  const directory = mkdtempSync(join(tmpdir(), 'ai020705-reviewpages-'));
  try {
    const before = join(directory, 'before');
    const after = join(directory, 'after');
    writeFileSync(before, original);
    writeFileSync(after, formatted);
    const result = spawnSync('diff', ['-u', before, after], {
      encoding: 'utf8'
    });
    console.log('REVIEW_PAGES_FORMAT_BEGIN');
    console.log(result.stdout || 'NO_DIFFERENCE');
    console.log('REVIEW_PAGES_FORMAT_END');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
