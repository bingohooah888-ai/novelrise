import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('temporary operator UI Prettier capture only', async () => {
  const files = [
    'tests/e2e/specs/contest-admin-review.js'
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const config = (await prettier.resolveConfig(file)) || {};
    const formatted = await prettier.format(source, {
      ...config,
      filepath: file
    });
    const chunks = encodeURIComponent(formatted).match(/.{1,800}/gu) || [];
    for (let i = 0; i < chunks.length; i += 1) {
      console.log('NOVELIGHT_REVIEW_PRETTIER_CHUNK|' + file + '|' + i + '|' + chunks[i]);
    }
    console.log('NOVELIGHT_REVIEW_PRETTIER_END|' + file + '|' + chunks.length);
  }
});
