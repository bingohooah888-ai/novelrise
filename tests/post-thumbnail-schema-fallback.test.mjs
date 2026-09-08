import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const postHtml = await readFile('post.html', 'utf8');

test('post page fails closed when official thumbnails are unavailable', () => {
  assert.ok(postHtml.includes('function disableThumbnailPosting(message)'));
  assert.ok(postHtml.includes('thumbnailReady=false'));
  assert.ok(postHtml.includes('button.disabled=true'));
  assert.ok(postHtml.includes('公式サムネイルを読み込めませんでした'));
  assert.equal(postHtml.includes('enableThumbnailCompatibilityMode'), false);
  assert.equal(postHtml.includes('enableThumbnailEmptyCatalogMode'), false);
  assert.equal(postHtml.includes('画像なしで投稿'), false);
});

test('empty active thumbnail catalog blocks posting', () => {
  assert.ok(postHtml.includes('if(!assets.length){disableThumbnailPosting'));
  assert.ok(postHtml.includes('公式サムネイルがまだ登録されていません'));
});

test('thumbnail remains required and is always inserted into payload', () => {
  assert.ok(postHtml.includes('input.required=true'));
  assert.ok(postHtml.includes('if(!thumbnailAsset){'));
  assert.ok(postHtml.includes('作品に合う画像を1枚選んでください'));
  assert.ok(postHtml.includes('thumbnail_asset_id:thumbnailAsset'));
  assert.equal(
    postHtml.includes('if(thumbnailAsset)payload.thumbnail_asset_id=thumbnailAsset'),
    false
  );
});
