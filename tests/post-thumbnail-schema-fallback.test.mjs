import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const postHtml = fs.readFileSync(
  new URL('../post.html', import.meta.url),
  'utf8'
);

test('post page degrades only when the thumbnail schema is unavailable', () => {
  assert.match(postHtml, /function thumbnailSchemaUnavailable\(error\)/);
  assert.match(postHtml, /PGRST205/);
  assert.match(postHtml, /message\.includes\('novel_thumbnail_assets'\)/);
  assert.match(postHtml, /enableThumbnailCompatibilityMode\(\)/);
  assert.match(
    postHtml,
    /作品画像機能の反映待ちです。画像なしで投稿を続けられます。/
  );
});

test('empty active thumbnail catalog temporarily allows no-image posting', () => {
  assert.match(postHtml, /function enableThumbnailEmptyCatalogMode\(\)/);
  assert.match(
    postHtml,
    /if\(!assets\.length\)\{enableThumbnailEmptyCatalogMode\(\);return true\}/
  );
  assert.match(
    postHtml,
    /公式サムネイル準備中のため、現在は画像なしで投稿できます。画像の提供開始後は選択が必須になります。/
  );
  assert.match(
    postHtml,
    /現在選べる公式サムネイルは準備中です。画像なしで投稿を続けられます。/
  );
});

test('thumbnail remains required when active thumbnails are available', () => {
  assert.match(postHtml, /thumbnailRequired=true/);
  assert.match(postHtml, /input\.required=true/);
  assert.match(postHtml, /if\(thumbnailRequired&&!thumbnailAsset\)/);
  assert.match(postHtml, /作品に合う画像を1枚選んでください。/);
});

test('compatibility modes omit the new column from the insert payload', () => {
  assert.match(
    postHtml,
    /thumbnailRequired=false;thumbnailReady=true;button\.disabled=false/
  );
  assert.match(
    postHtml,
    /if\(thumbnailAsset\)payload\.thumbnail_asset_id=thumbnailAsset/
  );
  assert.doesNotMatch(postHtml, /thumbnail_asset_id:thumbnailAsset/);
});

test('ordinary thumbnail loading failures still fail closed', () => {
  assert.match(postHtml, /thumbnailReady=false;button\.disabled=true/);
  assert.match(
    postHtml,
    /作品画像の選択肢を読み込めませんでした。時間をおいて再度お試しください。/
  );
});
