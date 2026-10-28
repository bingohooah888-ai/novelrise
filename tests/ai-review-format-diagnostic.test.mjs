// TEMPORARY local-CI formatting diagnostic. Remove after applying its diff.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { format, resolveConfig } from 'prettier';

test('print exact formatting patch for synthetic JWT test', async () => {
  const path = resolve('tests/ai-owner-bible-review-http-jwt.test.mjs');
  const source = readFileSync(path, 'utf8');
  const formatted = await format(source, {
    ...(await resolveConfig(path)),
    filepath: path
  });
  const root = mkdtempSync(join(tmpdir(), 'ai-jwt-format-'));
  try {
    const before = join(root, 'before.mjs');
    const after = join(root, 'after.mjs');
    writeFileSync(before, source);
    writeFileSync(after, formatted);
    if (source !== formatted) {
      try {
        execFileSync('diff', ['-u', before, after], { encoding: 'utf8' });
      } catch (error) {
        process.stdout.write('AI_JWT_FORMAT_DIFF_BEGIN\n');
        process.stdout.write(error.stdout);
        process.stdout.write('AI_JWT_FORMAT_DIFF_END\n');
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
