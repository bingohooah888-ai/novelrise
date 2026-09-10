import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const postHtml = await readFile('post.html', 'utf8');

test('post thumbnails fail closed when no safe official source is available', () => {
  assert.ok(postHtml.includes('function disableThumbnailPosting(message)'));
  assert.ok(postHtml.includes('thumbnailReady=false'));
  assert.ok(postHtml.includes('button.disabled=true'));
  assert.ok(postHtml.includes('サムネイル素材を読み込めませんでした'));
  assert.equal(postHtml.includes('画像なしで投稿'), false);
  assert.equal(/type="file"[^>]*thumbnail/iu.test(postHtml), false);
});

test('empty active composer catalog blocks posting unless a legacy official fallback exists', () => {
  assert.ok(postHtml.includes('公式サムネイル素材がまだ登録されていません'));
  assert.ok(postHtml.includes('loadLegacyThumbnails'));
  assert.ok(postHtml.includes('if(!assets.length){disableThumbnailPosting'));
});

test('thumbnail remains required through composer or legacy official asset', () => {
  assert.ok(postHtml.includes('NovelightThumbnailComposer.mount'));
  assert.ok(postHtml.includes('composerController.isValid()'));
  assert.ok(postHtml.includes('composerController.persist'));
  assert.ok(postHtml.includes('if(!composerMode&&!legacyAsset){'));
  assert.ok(
    postHtml.includes('if(legacyAsset)payload.thumbnail_asset_id=legacyAsset')
  );
  assert.equal(postHtml.includes('payload.thumbnail_url='), false);
});
