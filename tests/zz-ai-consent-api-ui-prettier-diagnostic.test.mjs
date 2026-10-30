import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('temporary exact prettier diffs for owner consent API and UI', () => {
  const files = [
    'api/ai-owner-bible-consent.js',
    'tests/ai-owner-bible-consent-api.test.mjs',
    'tests/ai-owner-bible-consent-panel.test.mjs'
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
