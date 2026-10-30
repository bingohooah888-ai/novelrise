import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('temporary exact Prettier diff for consent SQL structure test', () => {
  const file = 'tests/ai-owner-bible-consent-sql-structure.test.mjs';
  execFileSync(
    process.execPath,
    ['node_modules/prettier/bin/prettier.cjs', '--write', file],
    { encoding: 'utf8' }
  );
  const diff = execFileSync('git', ['diff', '--', file], {
    encoding: 'utf8',
    maxBuffer: 128000
  });
  process.stdout.write('\nPRETTIER_DIFF_START\n');
  process.stdout.write(diff);
  process.stdout.write('\nPRETTIER_DIFF_END\n');
});
