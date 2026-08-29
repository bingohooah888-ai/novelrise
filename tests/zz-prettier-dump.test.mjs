import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as prettier from 'prettier';

const paths = [
  'tests/production-migration-approved-dispatch.test.mjs',
  'tests/production-migration-stale-run-cleanup.test.mjs'
];

test('dump canonical Prettier output', async () => {
  for (const path of paths) {
    const source = await readFile(path, 'utf8');
    const formatted = await prettier.format(source, {
      filepath: path,
      singleQuote: true,
      semi: true,
      tabWidth: 2,
      trailingComma: 'none'
    });
    console.log(
      `PRETTIER_DUMP ${path} ${Buffer.from(formatted).toString('base64')}`
    );
  }
});
