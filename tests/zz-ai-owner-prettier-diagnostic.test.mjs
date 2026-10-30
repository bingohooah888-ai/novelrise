import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('temporary PRETTIER_ONLY_DIAGNOSTIC for owner AI route', () => {
  const files = [
    'api/ai-owner-bible-analyze.js',
    'tests/ai-owner-bible-analyze-api.test.mjs'
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
  process.stdout.write('\nPRETTIER_DIFF_START\n' + diff + '\nPRETTIER_DIFF_END\n');
});
