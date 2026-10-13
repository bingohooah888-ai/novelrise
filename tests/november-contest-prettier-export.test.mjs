import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

test('temporary stage-06-only formatting capture (remove before completion)', async () => {
  const files = [
    'api/_lib/november-contest-reader.js',
    'tests/november-contest-reader-http.test.mjs'
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const options = (await prettier.resolveConfig(file)) || {};
    const formatted = await prettier.format(source, { ...options, filepath: file });
    const encoded = encodeURIComponent(formatted);
    const chunks = encoded.match(/.{1,800}/gu) || [];
    for (let index = 0; index < chunks.length; index += 1) {
      console.log('NOVELIGHT_FORMAT_CHUNK|' + file + '|' + index + '|' + chunks[index]);
    }
    console.log('NOVELIGHT_FORMAT_END|' + file + '|' + chunks.length);
  }
});
