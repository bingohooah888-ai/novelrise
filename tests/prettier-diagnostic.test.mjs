import { readFile } from 'node:fs/promises';
import test from 'node:test';
import prettier from 'prettier';

const config = await prettier.resolveConfig('tests/async-ui-state.test.mjs');

for (const path of [
  'tests/async-ui-state.test.mjs',
  'tests/chapter41-beta-scout-record-preview.test.mjs'
]) {
  test(`prettier diagnostic ${path}`, async () => {
    const source = await readFile(path, 'utf8');
    const formatted = await prettier.format(source, {
      ...config,
      filepath: path
    });
    console.log(`PRETTIER_OUTPUT_START:${path}`);
    console.log(Buffer.from(formatted, 'utf8').toString('base64'));
    console.log(`PRETTIER_OUTPUT_END:${path}`);
  });
}
