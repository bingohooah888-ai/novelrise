import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('temporary admin review style capture (must remove before merge)', async () => {
  const files = [
    'api/_lib/admin-contest-review.js',
    'tests/admin-contest-review.test.mjs',
    'tests/november-contest-admin-review-contract.test.mjs'
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const configuration = (await prettier.resolveConfig(file)) || {};
    const formatted = await prettier.format(source, {
      ...configuration,
      filepath: file
    });
    const fragments = encodeURIComponent(formatted).match(/.{1,800}/gu) || [];
    for (let i = 0; i < fragments.length; i += 1) {
      console.log('NOVELIGHT_ADMIN_FORMAT_CHUNK|' + file + '|' + i + '|' + fragments[i]);
    }
    console.log('NOVELIGHT_ADMIN_FORMAT_END|' + file + '|' + fragments.length);
  }
});
