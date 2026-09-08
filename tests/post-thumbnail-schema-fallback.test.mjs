import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const postHtml = fs.readFileSync(
  new URL('../post.html', import.meta.url),
  'utf8'
);

test('post page fails closed when official thumbnails are unavailable', () => {
  assert.match(postHtml, /function disableThumbnailPosting\(message\)/);
  assert.match(postHtml, /thumbnailReady=false;button\.disabled=true/);
  assert.match(
    postHtml,
    /公式サムネイルを読み込めませんでした。時間をおいて再度お試しください。/
  );
  assert.doesNotMatch(postHtml, /enableThumbnailCompatibilityMode/);
  assert.doesNotMatch(postHtml, /enableThumbnailEmptyCatalogMode/);
  assert.doesNotMatch(postHtml, /画像なしで投稿/);
});

test('empty active thumbnail catalog blocks posting', () => {
  assert.match(
    postHtml,
    /if\(!assets\.length\)\{disableThumbnailPosting\('公式サムネイルがまだ登録されていません。時間をおいて再度お試しください。'\);return false\}/
  );
});

test('thumbnail remains required and is always inserted into payload', () => {
  assert.match(postHtml, /input\.required=true/);
  assert.match(
    postHtml,
    /if\(!thumbnailAsset\)\{status\.textContent='作品に合う画像を1枚選んでください。';return\}/
  );
  assert.match(postHtml, /thumbnail_asset_id:thumbnailAsset/);
  assert.doesNotMatch(
    postHtml,
    /if\(thumbnailAsset\)payload\.thumbnail_asset_id=thumbnailAsset/
  );
});
