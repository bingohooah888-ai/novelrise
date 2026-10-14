// TEMPORARY formatter capture for the new local-only Playwright fixture.
// Delete this file immediately after applying the exact repository formatting.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { format, resolveConfig } from 'prettier';

test('temporary community fixture formatting proof', async () => {
  const path = 'tests/e2e/specs/community-plaza-ui.js';
  const source = readFileSync(path, 'utf8');
  const config = (await resolveConfig(path)) ?? {};
  const formatted = await format(source, { ...config, filepath: path });
  assert.ok(formatted.length > 100);
  console.log('COMMUNITY_FORMAT_BASE64:' + Buffer.from(formatted).toString('base64'));
});
