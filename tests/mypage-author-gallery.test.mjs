import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mypage = await readFile('mypage.html', 'utf8');
const galleryJs = await readFile('novelight-author-gallery.js', 'utf8');
const galleryCss = await readFile('novelight-author-gallery.css', 'utf8');
const migration = await readFile(
  'supabase/migrations/20260906193000_author_gallery_upload.sql',
  'utf8'
);

test('author gallery is wired below the profile without replacing recent activity', () => {
  assert.match(mypage, /novelight-author-gallery\.css/u);
  assert.match(mypage, /novelight-author-gallery\.js/u);
  assert.match(galleryJs, /author-side-stack/u);
  assert.match(galleryJs, /side\.append\(profile\)/u);
  assert.match(galleryJs, /side\.append\(panel\)/u);
  assert.match(galleryJs, /gallery-panel/u);
  assert.match(mypage, /activity-panel/u);
  assert.match(galleryCss, /\.author-side-stack/u);
});

test('gallery accepts only bounded still images and supports removal', () => {
  assert.match(galleryJs, /MAX_ITEMS = 6/u);
  assert.match(galleryJs, /MAX_FILE_SIZE = 5242880/u);
  assert.match(galleryJs, /image\/jpeg/u);
  assert.match(galleryJs, /image\/png/u);
  assert.match(galleryJs, /image\/webp/u);
  assert.match(galleryJs, /crypto\.randomUUID\(\)/u);
  assert.match(galleryJs, /\.upload\(path, file/u);
  assert.match(galleryJs, /\.remove\(\[path\]\)/u);
});

test('Storage policy keeps gallery writes in the authenticated author folder and caps count server-side', () => {
  assert.match(migration, /'author-gallery'/u);
  assert.match(migration, /5242880/u);
  assert.match(migration, /novelight_author_gallery_can_upload_v1/u);
  assert.match(migration, /v_count < 6/u);
  assert.match(migration, /storage\.foldername\(name\)/u);
  assert.match(migration, /auth\.uid\(\)/u);
  assert.match(migration, /for insert/u);
  assert.match(migration, /for delete/u);
  assert.doesNotMatch(migration, /stripe/iu);
  assert.doesNotMatch(migration, /payment_status/iu);
});
