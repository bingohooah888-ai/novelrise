import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import prettier from 'prettier';

const paths = [
  'api/_lib/thumbnail-render.js',
  'tests/chapter39-thumbnail-composer.test.mjs',
  'tests/post-thumbnail-schema-fallback.test.mjs',
  'tests/thumbnail-render-api.test.mjs'
];

test('dump Chapter 39 Prettier canonical forms', async () => {
  for (const path of paths) {
    const source = await readFile(path, 'utf8');
    const formatted = await prettier.format(source, {
      filepath: path,
      singleQuote: true,
      semi: true,
      tabWidth: 2,
      trailingComma: 'none'
    });
    console.log(`CH39_PRETTIER ${path} ${Buffer.from(formatted, 'utf8').toString('base64')}`);
  }
  assert.ok(true);
});
