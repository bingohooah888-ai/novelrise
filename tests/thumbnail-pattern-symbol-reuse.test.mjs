import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const composer = await readFile('novelight-thumbnail-composer.js', 'utf8');
const migration = await readFile(
  'supabase/migrations/20260923004500_reuse_patterns_as_symbols.sql',
  'utf8'
);

test('central symbol picker also exposes active background patterns', () => {
  assert.match(
    composer,
    /layerType === 'symbol' && asset\.layer_type === 'pattern'/
  );
});

test('composition persistence accepts a pattern asset only for the symbol slot', () => {
  assert.match(migration, /v_layer\.layer_type = 'symbol'/);
  assert.match(migration, /a\.layer_type = 'pattern'/);
  assert.match(migration, /a\.layer_type = v_layer\.layer_type/);
  assert.match(migration, /a\.availability_status = 'active'/);
  assert.match(migration, /a\.template_key = v_template/);
});
