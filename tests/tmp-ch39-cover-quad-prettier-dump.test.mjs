import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import prettier from 'prettier';

const paths = [
  'api/_lib/admin-thumbnails.js',
  'api/_lib/cover-mask-png.js',
  'tests/chapter39-cover-quad-mask.test.mjs'
];

test('dump remaining Chapter 39 cover quad Prettier diffs', async () => {
  for (const [index, path] of paths.entries()) {
    const source = await readFile(path, 'utf8');
    const config = (await prettier.resolveConfig(path)) ?? {};
    const formatted = await prettier.format(source, { ...config, filepath: path });
    const before = `/tmp/ch39-cover-quad-before-${index}`;
    const after = `/tmp/ch39-cover-quad-after-${index}`;
    await writeFile(before, source);
    await writeFile(after, formatted);
    try {
      execFileSync('diff', ['-u', before, after], { encoding: 'utf8' });
    } catch (error) {
      console.log(`CH39_COVER_QUAD_REMAINING_DIFF ${path}\n${error.stdout}`);
    }
  }
  assert.ok(true);
});
