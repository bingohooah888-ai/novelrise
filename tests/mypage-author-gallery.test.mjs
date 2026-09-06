import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [mypage, retirement, originalMigration] = await Promise.all([
  readFile('mypage.html', 'utf8'),
  readFile('supabase/migrations/20260906204000_retire_author_gallery_feature.sql', 'utf8'),
  readFile('supabase/migrations/20260906193000_author_gallery_upload.sql', 'utf8')
]);

test('author room no longer loads or exposes the free-form gallery', async () => {
  assert.doesNotMatch(mypage, /novelight-author-gallery\.(?:css|js)/u);
  assert.doesNotMatch(mypage, /画像・イラスト/u);
  assert.doesNotMatch(mypage, /画像を追加/u);
  assert.doesNotMatch(mypage, /gallery-panel/u);
  await assert.rejects(readFile('novelight-author-gallery.js', 'utf8'), { code: 'ENOENT' });
  await assert.rejects(readFile('novelight-author-gallery.css', 'utf8'), { code: 'ENOENT' });
});

test('avatar upload remains available after gallery removal', () => {
  assert.match(mypage, /id="avatarInput"/u);
  assert.match(mypage, /author-avatars/u);
  assert.match(mypage, /JPEG・PNG・WebPの画像/u);
  assert.match(mypage, /2097152/u);
});

test('gallery retirement is forward-only and preserves existing Storage data', () => {
  assert.match(originalMigration, /'author-gallery'/u);
  assert.match(retirement, /revoke all on function public\.novelight_author_gallery_can_upload_v1/u);
  assert.match(retirement, /drop policy if exists "Author gallery insert own"/u);
  assert.match(retirement, /drop policy if exists "Author gallery delete own"/u);
  assert.doesNotMatch(retirement, /delete\s+from\s+storage\.objects/iu);
  assert.doesNotMatch(retirement, /delete\s+from\s+storage\.buckets/iu);
  assert.doesNotMatch(retirement, /drop\s+table/iu);
  assert.doesNotMatch(retirement, /stripe/iu);
});
