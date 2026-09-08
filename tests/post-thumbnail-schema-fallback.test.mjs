import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const postHtml = fs.readFileSync(
  new URL('../post.html', import.meta.url),
  'utf8'
);

test('post page fails closed when official thumbnails are unavailable', () => {
  assert.ok(postHtml.includes('function disableThumbnailPosting(message)'));
  assert.ok(postHtml.includes('thumbnailReady=false;button.disabled=true'));
  assert.ok(
    postHtml.includes(
      '公式サムネイルを読み込めませんでした。時間をおいて再度お試しください。'
    )
  );
  assert.equal(postHtml.includes('enableThumbnailCompatibilityMode'), false);
  assert.equal(postHtml.includes('enableThumbnailEmptyCatalogMode'), false);
  assert.equal(postHtml.includes('画像なしで投稿'), false);
});

test('empty active thumbnail catalog blocks posting', () => {
  assert.ok(
    postHtml.includes(
      "if(!assets.length){disableThumbnailPosting('公式サムネイルがまだ登録されていません。時間をおいて再度お試しください。');return false}"
    )
  );
});

test('thumbnail remains required and is always inserted into payload', () => {
  assert.ok(postHtml.includes('input.required=true'));
  assert.ok(
    postHtml.includes(
      "if(!thumbnailAsset){status.textContent='作品に合う画像を1枚選んでください。';return}"
    )
  );
  assert.ok(postHtml.includes('thumbnail_asset_id:thumbnailAsset'));
  assert.equal(
    postHtml.includes('if(thumbnailAsset)payload.thumbnail_asset_id=thumbnailAsset'),
    false
  );
});
