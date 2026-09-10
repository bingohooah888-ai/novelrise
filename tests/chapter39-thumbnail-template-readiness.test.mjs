import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readiness = await readFile(
  'supabase/migrations/20260910224000_chapter39_thumbnail_template_readiness.sql',
  'utf8'
);

test('authors only see 1086x1448 templates with an internal cover mask', () => {
  assert.match(readiness, /availability_status = 'active'/i);
  assert.match(readiness, /canvas_width = 1086/i);
  assert.match(readiness, /canvas_height = 1448/i);
  assert.match(readiness, /cover_mask_url is not null/i);
  assert.match(readiness, /to anon, authenticated/i);
});
