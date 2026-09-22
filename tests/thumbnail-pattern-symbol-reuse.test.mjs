import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const composer = await readFile('novelight-thumbnail-composer.js', 'utf8');
const migration = await readFile(
  'supabase/migrations/20260923061500_move_legacy_patterns_to_symbols.sql',
  'utf8'
);

test('thumbnail pickers expose only assets owned by their requested layer', () => {
  assert.match(composer, /asset\.layer_type === layerType/);
  assert.doesNotMatch(
    composer,
    /layerType === 'symbol' && asset\.layer_type === 'pattern'/
  );
});

test('legacy background-pattern rows are moved to the symbol layer', () => {
  assert.match(migration, /set layer_type = 'symbol'/);
  assert.match(migration, /and layer_type = 'pattern'/);
  assert.match(migration, /and template_key = 'book-v1'/);
  assert.match(migration, /and availability_status = 'active'/);
  const ids = migration.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/g) || [];
  assert.equal(ids.length, 8);
});
