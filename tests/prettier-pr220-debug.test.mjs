import { spawnSync } from 'node:child_process';
import test from 'node:test';

const targets = [
  'tests/production-migration-approved-dispatch.test.mjs',
  '.github/workflows/production-migration-approved-dispatch.yml',
  '.github/workflows/supabase-production-auto-deploy.yml'
];

test('print PR 220 prettier diff', () => {
  const format = spawnSync('npx', ['prettier', '--write', ...targets], {
    encoding: 'utf8'
  });
  if (format.status !== 0) {
    throw new Error(format.stderr || format.stdout);
  }

  const diff = spawnSync('git', ['diff', '--', ...targets], {
    encoding: 'utf8'
  });
  if (diff.status !== 0) {
    throw new Error(diff.stderr || diff.stdout);
  }

  console.log('\nPR220_PRETTIER_DIFF_BEGIN\n');
  console.log(diff.stdout);
  console.log('PR220_PRETTIER_DIFF_END');
});
