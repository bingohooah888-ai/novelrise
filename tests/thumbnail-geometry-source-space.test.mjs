import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(
  await readFile('novelight-base-books-32.json', 'utf8')
);
const composer = await readFile('novelight-thumbnail-composer.js', 'utf8');
const runtime = await readFile('novelight-thumbnail-runtime.js', 'utf8');
const admin = await readFile('admin-thumbnails.html', 'utf8');
const api = await readFile('api/_lib/admin-thumbnails.js', 'utf8');
const importer = await readFile('novelight-base-books-32-import.js', 'utf8');
const migration = await readFile(
  'supabase/migrations/20260920204000_thumbnail_geometry_source_space.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260920204000_thumbnail_geometry_source_space_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260920204000_thumbnail_geometry_source_space_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260920204000_thumbnail_geometry_source_space_rollback.sql',
  'utf8'
);
test('official 32-book manifest has one source-space geometry and no parallel canvas geometry', () => {
  assert.equal(manifest.sourceGeometry.width, 1024);
  assert.equal(manifest.sourceGeometry.height, 1536);
  assert.equal(manifest.sourceGeometry.renderStrategy, 'contain');
  assert.equal(manifest.canvasGeometry, undefined);
  assert.deepEqual(manifest.sourceGeometry.coverQuad, {
    topLeft: { x: 164, y: 360 },
    topRight: { x: 714, y: 252 },
    bottomRight: { x: 984, y: 1003 },
    bottomLeft: { x: 319, y: 1156 }
  });
});

test('migration stores book-v1 cover_quad in base_book source coordinates', () => {
  assert.match(migration, /add column if not exists cover_quad_space text/);
  assert.match(
    migration,
    /add column if not exists base_book_source_width integer/
  );
  assert.match(
    migration,
    /add column if not exists base_book_source_height integer/
  );
  assert.match(migration, /cover_mask_source = 'cover_quad'/);
  assert.match(migration, /cover_quad_space = 'base_book_source'/);
  assert.match(migration, /base_book_source_width = 1024/);
  assert.match(migration, /base_book_source_height = 1536/);
  for (const value of [
    'cover_top_left_x = 164',
    'cover_top_left_y = 360',
    'cover_top_right_x = 714',
    'cover_top_right_y = 252',
    'cover_bottom_right_x = 984',
    'cover_bottom_right_y = 1003',
    'cover_bottom_left_x = 319',
    'cover_bottom_left_y = 1156'
  ])
    assert.ok(migration.includes(value), value);
});
test('render surfaces keep geometry work out of reader runtime', () => {
  assert.match(composer, /function resolveBookGeometry/);
  assert.match(composer, /const bookRect = containRect/);
  assert.match(composer, /drawResolvedBaseBook/);
  assert.match(composer, /resolved\.coverQuad/);
  assert.doesNotMatch(runtime, /geometry\.resolveBookGeometry/);
  assert.doesNotMatch(runtime, /geometry\.drawResolvedBaseBook/);
  assert.match(runtime, /composition\?\.render_url/);
  assert.match(admin, /geometry\.resolveBookGeometry/);
  assert.match(admin, /geometry\.drawResolvedBaseBook/);
  assert.match(admin, /geometry\.canvasPointToSource/);
});

test('reader RPC v3 carries canonical geometry while v2 remains rolling-deploy fallback', () => {
  assert.match(
    migration,
    /create or replace function public\.novelight_thumbnail_compositions_v3/
  );
  assert.match(migration, /cover_quad_space text/);
  assert.match(migration, /base_book_source_width integer/);
  assert.match(runtime, /rpc\('novelight_thumbnail_compositions_v3'/);
  assert.match(runtime, /rpc\('novelight_thumbnail_compositions_v2'/);
});

test('ADMIN mask remains derived while stored geometry stays source-space canonical', () => {
  assert.match(api, /resolveSourceCoverQuad/);
  assert.match(api, /resolved\.maskQuad/);
  assert.match(api, /resolved\.storedQuad/);
  assert.match(importer, /manifest\.sourceGeometry\?\.coverQuad/);
  assert.match(importer, /resolvedGeometryReady/);
  assert.doesNotMatch(importer, /canvasGeometry/);
});
test('migration invalidates stale rendered caches and ships bounded safety artifacts', () => {
  assert.match(
    migration,
    /update public\.novel_thumbnail_compositions[\s\S]*render_url = null/i
  );
  assert.match(
    migration,
    /update public\.novels n[\s\S]*thumbnail_url = null/i
  );
  assert.match(precheck, /official base_book pack must have 32 active assets/);
  assert.match(
    precheck,
    /saved composition still references a legacy base_book/
  );
  assert.match(
    postcheck,
    /book-v1 source-space geometry does not match canonical values/
  );
  assert.match(postcheck, /novelight_thumbnail_compositions_v3 is missing/);
  assert.match(postcheck, /stale book-v1 render cache remains/);
});

test('rollback restores the prior canvas-space contract without deleting official books', () => {
  assert.match(rollback, /cover_quad_space = 'canvas'/);
  assert.match(rollback, /cover_top_left_x = 220/);
  assert.match(rollback, /cover_top_right_x = 730/);
  assert.match(rollback, /cover_bottom_right_x = 980/);
  assert.match(rollback, /cover_bottom_left_x = 363/);
  assert.match(
    rollback,
    /drop function if exists public\.novelight_thumbnail_compositions_v3/
  );
  assert.match(rollback, /drop column if exists base_book_source_height/);
  assert.match(rollback, /drop column if exists base_book_source_width/);
  assert.match(rollback, /drop column if exists cover_quad_space/);
  assert.doesNotMatch(rollback, /delete from public\.novel_thumbnail_assets/i);
});
