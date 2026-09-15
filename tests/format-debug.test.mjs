import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as prettier from 'prettier';

test('print canonical formatting for the two new tests', async () => {
  for (const path of [
    'tests/reading-continuity.test.mjs',
    'tests/author-draft-ux.test.mjs'
  ]) {
    const source = await readFile(path, 'utf8');
    const formatted = await prettier.format(source, {
      filepath: path,
      singleQuote: true,
      trailingComma: 'none'
    });
    console.log(`FORMAT_START:${path}\n${formatted}FORMAT_END:${path}`);
    assert.ok(formatted.length > 0);
  }
});
