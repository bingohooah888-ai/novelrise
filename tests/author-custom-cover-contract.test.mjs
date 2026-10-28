import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('custom covers have owner RLS and upload limits', async () => {
  const sql = await source(
    'supabase/migrations/20261018060000_author_custom_covers.sql'
  );
  assert.match(sql, /create table public\.novel_custom_covers/u);
  assert.match(sql, /novel_id bigint primary key/u);
  assert.match(sql, /enable row level security/u);
  assert.match(sql, /n\.user_id = \(select auth\.uid\(\)\)/u);
  assert.match(sql, /novelight_custom_cover_can_upload_v1/u);
  assert.match(sql, /v_count < 3/u);
  assert.match(sql, /5242880/u);
  assert.doesNotMatch(sql, /update public\.novels set thumbnail_url/iu);
});

test('cover processing and social card preserve the artwork', async () => {
  const [editor, page, og] = await Promise.all([
    source('novelight-custom-cover.js'),
    source('work-cover.html'),
    source('api/og/novel.js')
  ]);
  assert.match(page, /1200×1800px/u);
  assert.match(page, /data-cover-x-preview/u);
  assert.match(page, /class="custom-cover"[^>]+hidden/u);
  assert.match(editor, /root\.hidden = false/u);
  assert.match(editor, /const WIDTH = 1200/u);
  assert.match(editor, /const HEIGHT = 1800/u);
  assert.match(
    editor,
    /Math\.min\(WIDTH \/ picture\.width, HEIGHT \/ picture\.height\)/u
  );
  assert.match(editor, /bucket\.upload\(newPath/u);
  assert.match(editor, /onConflict: 'novel_id'/u);
  assert.match(og, /fit: 'contain'/u);
});

test('custom covers affect work detail, X and discovery', async () => {
  const [work, og, x, list] = await Promise.all([
    source('novelight-novel-detail.js'),
    source('api/og/novel-data.js'),
    source('novelight-x-image-share.js'),
    source('novelight-thumbnail-runtime.js')
  ]);
  assert.match(work, /from\('novel_custom_covers'\)/u);
  const customAt = work.indexOf("from('novel_custom_covers')");
  const officialAt = work.indexOf("from('novels').select('thumbnail_url')");
  assert.ok(customAt >= 0 && customAt < officialAt);
  assert.match(og, /loadCustomCover\(client, novel\.id\)/u);
  assert.match(
    og,
    /const authorImageUrl = customCoverUrl \|\| officialAssetUrl/u
  );
  assert.match(x, /from\('novel_custom_covers'\)/u);
  assert.match(x, /currentCardRevision\(shareUrl\)/u);
  assert.match(list, /from\('novel_custom_covers'\)/u);
  assert.match(list, /CUSTOM_COVER_BATCH/u);
  assert.match(list, /novelight-has-custom-cover/u);
  assert.match(list, /getPublicUrl\(path\)/u);
  assert.match(list, /custom cover lookup unavailable/u);
  // Never overlay an official cover on an already populated custom image card.
  assert.match(list, /!link\.classList\.contains\('novelight-has-custom-cover'\)/u);
  assert.match(list, /CUSTOM_COVER_PATH\.exec\(path\)/u);
  assert.match(list, /matched\[1\] !== id/u);
  assert.match(list, /currentImage\.src = previous/u);
});
