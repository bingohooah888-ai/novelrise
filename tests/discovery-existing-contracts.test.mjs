import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const script = await readFile(
  new URL('novelight-discovery-list.js', root),
  'utf8'
);

test('recommended discovery still uses trusted feed and consumes returned receipts', () => {
  assert.match(script, /p_surface: 'search_recommended'/);
  assert.match(script, /novelight_trusted_discovery_feed/);
  assert.match(script, /const page = candidates\.slice\(0, pageSize\);/);
  assert.match(script, /const visible = appendRows\(page\);/);
  assert.match(script, /await recordTrusted\(visible\);/);
  assert.match(script, /record_trusted_allocation_receipts/);
});

test('new and seed pagination semantics remain intact while changing only impression accounting', () => {
  assert.match(script, /p_sort: 'new'/);
  assert.match(script, /p_offset: neutralOffset/);
  assert.match(script, /neutralOffset \+= rows\.length/);
  assert.match(script, /p_limit: pageSize \+ 1/);
  assert.match(script, /p_offset: seedOffset/);
  assert.match(script, /seedOffset \+= page\.length/);
  assert.match(script, /row\.status === 'published'/);
  assert.match(script, /Number\(row\.light_seed_count \|\| 0\) > 0/);
});
