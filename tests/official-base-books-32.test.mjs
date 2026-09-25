import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveSourceCoverQuad } from '../api/_lib/cover-mask-png.js';

const manifest = JSON.parse(
  await readFile('novelight-base-books-32.json', 'utf8')
);
const importer = await readFile('novelight-base-books-32-import.js', 'utf8');
const composer = await readFile('novelight-thumbnail-composer.js', 'utf8');
const runtime = await readFile('novelight-thumbnail-runtime.js', 'utf8');
const admin = await readFile('admin-thumbnails.html', 'utf8');
const batchPage = await readFile('admin-base-books-32.html', 'utf8');
const api = await readFile('api/_lib/admin-thumbnails.js', 'utf8');
const migration = await readFile(
  'supabase/migrations/20260919203910_official_base_books_32_metadata_and_activation.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260919203910_official_base_books_32_metadata_and_activation_rollback.sql',
  'utf8'
);

test('official base_book pack locks 32 ordered Japanese color/material rows', () => {
  assert.equal(manifest.packKey, 'NOVELIGHT_base_books_32_final');
  assert.equal(manifest.templateKey, 'book-v1');
  assert.equal(manifest.expectedPngCount, 32);
  assert.equal(manifest.items.length, 32);
  assert.equal(
    manifest.zipSha256,
    '51f659667a56fa83a4f037bcc3cd92dc1bbf2f7f26357548e8171a1db2f911f2'
  );
  assert.deepEqual(
    manifest.items.map((item) => item.displayOrder),
    Array.from({ length: 32 }, (_, index) => index + 1)
  );
  assert.equal(new Set(manifest.items.map((item) => item.fileName)).size, 32);
  assert.equal(new Set(manifest.items.map((item) => item.sha256)).size, 32);
  for (const item of manifest.items) {
    assert.equal(item.category, 'base_book');
    assert.equal(item.width, 1024);
    assert.equal(item.height, 1536);
    assert.equal(item.bitDepth, 8);
    assert.equal(item.colorType, 6);
    assert.match(item.fileName, /^base_book_[a-z0-9_]+_01[.]png$/);
    assert.match(item.sha256, /^[0-9a-f]{64}$/);
    assert.ok(item.displayNameJa.length > 0);
    assert.ok(item.materialJa.length > 0);
  }
});

test('source-space cover_quad is the only canonical geometry and resolves through contain', () => {
  const source = manifest.sourceGeometry;
  assert.equal(manifest.canvasGeometry, undefined);
  const raw = {
    top_left: source.coverQuad.topLeft,
    top_right: source.coverQuad.topRight,
    bottom_right: source.coverQuad.bottomRight,
    bottom_left: source.coverQuad.bottomLeft
  };
  const resolved = resolveSourceCoverQuad(
    raw,
    source.width,
    source.height,
    1086,
    1448
  );
  assert.deepEqual(resolved.coverQuad, {
    top_left: { x: 215, y: 339 },
    top_right: { x: 733, y: 238 },
    bottom_right: { x: 988, y: 946 },
    bottom_left: { x: 361, y: 1090 }
  });
  assert.ok(Math.abs(resolved.bookRect.x - 60.3333333333) < 1e-6);
  assert.equal(resolved.bookRect.y, 0);
});

test('author and ADMIN share geometry while reader uses cached render output', () => {
  assert.match(composer, /function resolveBookGeometry/);
  assert.match(composer, /function drawResolvedBaseBook/);
  assert.match(composer, /resolved\.coverQuad/);
  assert.doesNotMatch(runtime, /geometry\.resolveBookGeometry/);
  assert.doesNotMatch(runtime, /geometry\.drawResolvedBaseBook/);
  assert.match(runtime, /composition\?\.render_url/);
  assert.match(admin, /geometry\.resolveBookGeometry/);
  assert.match(admin, /geometry\.drawResolvedBaseBook/);
  assert.match(admin, /geometry\.canvasPointToSource/);
  assert.doesNotMatch(composer, /drawContainedAsset/);
  assert.doesNotMatch(runtime, /async function drawContained/);
  assert.doesNotMatch(admin, /async function drawContained/);
});

test('author base_book picker uses two-line Japanese display metadata with legacy fallback', () => {
  assert.match(composer, /display_name_ja,material_ja,source_pack_key/);
  assert.match(composer, /type === 'base_book' && asset\.display_name_ja/);
  assert.match(composer, /asset\.material_ja/);
  assert.match(composer, /nl-thumb-option-label/);
  assert.match(admin, /admin-base-books-32\.html/);
});

test('32-book importer validates exact binaries, stages retired, then activates atomically', () => {
  assert.match(batchPage, /NOVELIGHT_base_books_32_final\.zip/);
  assert.match(importer, /zipSha256 === manifest\.zipSha256/);
  assert.match(importer, /hash === item\.sha256/);
  assert.match(importer, /action: 'finalize-official-base-book'/);
  assert.match(importer, /action: 'activate-official-base-book-pack'/);
  assert.match(importer, /staged\.length === 32/);
  assert.match(api, /verifyPublicObjectSha256/);
  assert.match(api, /createHash\('sha256'\)/);
  assert.match(api, /novelight_admin_stage_official_base_book/);
  assert.match(api, /novelight_admin_activate_official_base_book_pack/);
});

test('database activation is fail-closed and preserves the legacy base_book as retired', () => {
  assert.match(migration, /add column if not exists display_name_ja text/);
  assert.match(migration, /add column if not exists material_ja text/);
  assert.match(migration, /v_pack <> 'NOVELIGHT_base_books_32_final'/);
  assert.match(migration, /where source_pack_key=v_pack/);
  assert.match(
    migration,
    /availability_status = 'retired'|availability_status='retired'/
  );
  assert.match(migration, /v_count<>32 or v_bad<>0/);
  assert.match(
    migration,
    /A saved composition still references a legacy base_book/
  );
  assert.match(migration, /source_pack_key is distinct from v_pack/);
  assert.doesNotMatch(migration, /delete from public\.novel_thumbnail_assets/i);
});

test('rollback refuses lossy schema removal after official pack rows exist', () => {
  assert.match(
    rollback,
    /Refusing rollback: official base_book pack rows already exist/
  );
  assert.match(
    rollback,
    /drop function if exists public\.novelight_admin_activate_official_base_book_pack/
  );
  assert.match(
    rollback,
    /drop function if exists public\.novelight_admin_stage_official_base_book/
  );
});
