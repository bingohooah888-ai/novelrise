import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('ranking cards keep rank, cover, and copy in separate desktop and mobile columns', () => {
  const css = read('novelight-accessibility.css');

  assert.match(
    css,
    /body\.novelight-page-ranking \.card\s*\{[\s\S]*?grid-template-columns:\s*70px 92px minmax\(0, 1fr\) !important;/
  );
  assert.match(
    css,
    /@media \(max-width: 600px\)[\s\S]*?body\.novelight-page-ranking \.card\s*\{[\s\S]*?grid-template-columns:\s*54px 70px minmax\(0, 1fr\) !important;/
  );
  assert.match(
    css,
    /body\.novelight-page-ranking \.novel-cover-image,[\s\S]*?width:\s*92px !important;/
  );
});

test('ranking feed excludes zero-signal rows outside the new-arrivals tab', () => {
  const migration = read(
    'supabase/migrations/20260928112500_fix_ranking_zero_signal_entries.sql'
  );

  assert.match(migration, /when p_sort = 'new' then true/);
  assert.match(
    migration,
    /when p_sort in \('reads', 'pv'\) then c\.valid_read_count > 0/
  );
  assert.match(
    migration,
    /when p_sort = 'favorites' then c\.favorite_count > 0/
  );
  assert.match(
    migration,
    /else \(c\.valid_read_count \+ c\.favorite_count \* 10\) > 0/
  );
});
