import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('temporary exact Prettier diff for owner consent actions', () => {
  const files = [
    'api/_lib/ai/owner-novel-bible-consent-actions.js',
    'tests/ai-owner-bible-consent-actions.test.mjs'
  ];
  execFileSync(
    process.execPath,
    ['node_modules/prettier/bin/prettier.cjs', '--write', ...files],
    { encoding: 'utf8' }
  );
  const diff = execFileSync('git', ['diff', '--', ...files], {
    encoding: 'utf8',
    maxBuffer: 128000
  });
  process.stdout.write('\nPRETTIER_DIFF_START\n');
  process.stdout.write(diff);
  process.stdout.write('\nPRETTIER_DIFF_END\n');
});
