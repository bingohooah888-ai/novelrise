import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20260929080000_thumbnail_render_png_fallback.sql', import.meta.url),
  'utf8'
);

test('thumbnail render bucket accepts WebP and Safari PNG fallback', () => {
  assert.match(migration, /allowed_mime_types\s*=\s*ARRAY\['image\/webp',\s*'image\/png'\]/);
  assert.match(migration, /WHERE id = 'novel-thumbnail-renders'/);
  assert.doesNotMatch(migration, /file_size_limit/);
});
