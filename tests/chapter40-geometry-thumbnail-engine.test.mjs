import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { normalizeCoverQuad } from '../api/_lib/cover-mask-png.js';

const composer = await readFile('novelight-thumbnail-composer.js', 'utf8');
const runtime = await readFile('novelight-thumbnail-runtime.js', 'utf8');
const admin = await readFile('admin-thumbnails.html', 'utf8');
const migration = await readFile(
  'supabase/migrations/20260911110000_chapter40_geometry_thumbnail_engine.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260911110000_chapter40_geometry_thumbnail_engine_rollback.sql',
  'utf8'
);

function geometryRuntime() {
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(composer, context);
  return context.window.NovelightThumbnailComposer.geometry;
}

const validQuad = {
  top_left: { x: 120, y: 160 },
  top_right: { x: 930, y: 250 },
  bottom_right: { x: 850, y: 1120 },
  bottom_left: { x: 180, y: 1030 }
};

test('shared Geometry Engine validates quad and projects normalized cover corners exactly', () => {
  const geometry = geometryRuntime();
  const result = geometry.validateQuad(validQuad, 1086, 1448);
  assert.equal(result.valid, true);
  const probes = [
    [0, 0, validQuad.top_left],
    [1, 0, validQuad.top_right],
    [1, 1, validQuad.bottom_right],
    [0, 1, validQuad.bottom_left]
  ];
  for (const [u, v, expected] of probes) {
    const actual = geometry.projectUnitPoint(result.homography, u, v);
    assert.ok(Math.abs(actual.x - expected.x) < 1e-6);
    assert.ok(Math.abs(actual.y - expected.y) < 1e-6);
  }
});

test('Geometry Validation rejects duplicates, self intersections and unstable/small geometry', () => {
  const geometry = geometryRuntime();
  const duplicate = structuredClone(validQuad);
  duplicate.bottom_left = { ...duplicate.top_left };
  assert.equal(geometry.validateQuad(duplicate).valid, false);
  const crossed = {
    top_left: { x: 100, y: 100 },
    top_right: { x: 900, y: 1000 },
    bottom_right: { x: 100, y: 1000 },
    bottom_left: { x: 900, y: 100 }
  };
  assert.equal(geometry.validateQuad(crossed).valid, false);
  assert.throws(() => normalizeCoverQuad(crossed), /non-self-intersecting convex/);
  assert.match(migration, /create or replace function public\.novelight_geometry_quad_valid/i);
  assert.match(migration, /abs\(geometry\.twice_area\) >= 200/i);
});

test('renderer perspective-transforms all four cover-surface roles and never renders from PNG mask', () => {
  assert.match(composer, /const SURFACE_TYPES = \['cover', 'pattern', 'symbol', 'frame'\]/);
  assert.match(composer, /for \(const type of SURFACE_TYPES\) await drawPerspectiveAsset/);
  assert.match(composer, /drawPerspectiveImage\(context, image, quad\)/);
  assert.doesNotMatch(composer, /globalCompositeOperation\s*=\s*['"]destination-in['"]/);
  const renderStart = composer.indexOf('async function renderSelectionToCanvas');
  const renderEnd = composer.indexOf('function canvasBlob', renderStart);
  const renderBody = composer.slice(renderStart, renderEnd);
  assert.doesNotMatch(renderBody, /cover_mask_url/);
});

test('effect outside-cover rendering is controlled only by template data', () => {
  assert.match(composer, /effect_allow_outside_cover/);
  assert.match(composer, /template\.effect_allow_outside_cover === true/);
  assert.match(composer, /clipToCoverQuad\(context, quad\)/);
  assert.match(migration, /effect_allow_outside_cover boolean not null default false/);
});

test('all active official templates require validated cover_quad without PNG mask readiness', () => {
  assert.match(migration, /cover_mask_source = 'cover_quad'/);
  assert.doesNotMatch(migration, /template_key <> 'book-v1'/);
  const policyStart = migration.indexOf('create policy "Public can read active thumbnail templates"');
  const triggerStart = migration.indexOf('create or replace function', policyStart);
  const policy = migration.slice(policyStart, triggerStart);
  assert.doesNotMatch(policy, /cover_mask_url is not null/);
  assert.match(policy, /novelight_geometry_quad_valid/);
  assert.match(policy, /cover_top_left_x/);
});

test('ADMIN Geometry Editor uses the exact shared engine for validation and realtime transform preview', () => {
  assert.match(admin, /<script src="novelight-thumbnail-composer\.js"><\/script>/);
  assert.match(admin, /geometry=NovelightThumbnailComposer\.geometry/);
  assert.match(admin, /geometry\.validateCoverQuad/);
  assert.match(admin, /geometry\.drawPerspectiveImage/);
  assert.match(admin, /quadCanvas\.addEventListener\('pointermove'/);
  assert.match(admin, /data-point="top_left" data-axis="x"/);
  assert.match(admin, /debug mask PNGは描画には使用しません/);
});

test('reader cache fallback uses geometry-aware v2 data and the shared Perspective Engine', () => {
  assert.match(migration, /create or replace function public\.novelight_thumbnail_compositions_v2/i);
  assert.match(runtime, /rpc\('novelight_thumbnail_compositions_v2'/);
  assert.match(runtime, /NovelightThumbnailComposer\?\.geometry/);
  assert.match(runtime, /geometry\.validateCoverQuad/);
  assert.match(runtime, /geometry\.drawPerspectiveImage/);
  assert.doesNotMatch(runtime, /cover_mask_url/);
  assert.doesNotMatch(runtime, /maskImage/);
});

test('generic quad engine is reusable for future spine/page/edge geometry without template branches', () => {
  assert.match(composer, /validateQuad/);
  assert.match(composer, /createHomography/);
  assert.match(composer, /drawPerspectiveImage/);
  assert.doesNotMatch(composer, /template\.template_key === 'book-v1'/);
});

test('Chapter 40 rollback refuses lossy downgrade and removes v2-only database objects', () => {
  assert.match(rollback, /rollback refused: Chapter 40 effect outside-cover policy is in use/i);
  assert.match(rollback, /rollback refused: geometry-backed template has no Chapter 39 debug mask/i);
  assert.match(rollback, /drop function if exists public\.novelight_thumbnail_compositions_v2/i);
  assert.match(rollback, /drop function if exists public\.novelight_geometry_quad_valid/i);
});
