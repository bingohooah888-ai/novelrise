import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const post = readFileSync(join(root, 'post.html'), 'utf8');
const admin = readFileSync(join(root, 'admin-thumbnails.html'), 'utf8');
const runtime = readFileSync(
  join(root, 'novelight-thumbnail-runtime.js'),
  'utf8'
);
const migration = readFileSync(
  join(root, 'supabase/migrations/20260904133000_official_novel_thumbnails.sql'),
  'utf8'
);

test('authors must select an official thumbnail when creating a novel', () => {
  assert.match(post, /作品に合う画像を選んでください/u);
  assert.match(post, /name='thumbnailAsset'|name="thumbnailAsset"/u);
  assert.match(post, /thumbnail_asset_id:thumbnailAsset/u);
  assert.match(post, /from\('novel_thumbnail_assets'\)/u);
});

test('admin upload uses a signed Storage upload before registration', () => {
  assert.match(admin, /prepare-upload/u);
  assert.match(admin, /uploadToSignedUrl/u);
  assert.match(admin, /finalize-upload/u);
});

test('reader discovery cards resolve the selected thumbnail from novels', () => {
  assert.match(runtime, /select\('id,thumbnail_url'\)/u);
  assert.match(runtime, /novel-cover-placeholder/u);
  assert.match(runtime, /novelight-page-ranking/u);
});

test('database enforces official thumbnail selection instead of arbitrary URLs', () => {
  assert.match(migration, /novel_thumbnail_assets/u);
  assert.match(migration, /novelight_sync_official_thumbnail/u);
  assert.match(migration, /Selected official thumbnail is unavailable/u);
  assert.match(migration, /novel-thumbnails/u);
});
