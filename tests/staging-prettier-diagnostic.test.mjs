import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as prettier from 'prettier';

test('prints canonical Staging migration test formatting', async () => {
  const path = 'tests/staging-migration-sync.test.mjs';
  const source = await readFile(path, 'utf8');
  const config = (await prettier.resolveConfig(path)) ?? {};
  const formatted = await prettier.format(source, { ...config, filepath: path });

  console.log('NOVELIGHT_PRETTIER_BASE64_BEGIN');
  console.log(Buffer.from(formatted, 'utf8').toString('base64'));
  console.log('NOVELIGHT_PRETTIER_BASE64_END');
  assert.ok(formatted.length > 0);
});
