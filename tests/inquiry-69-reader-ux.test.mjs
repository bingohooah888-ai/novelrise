import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import vm from 'node:vm';

function read(name) {
  return fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
}

test('work cards and notes keep mobile content compact', () => {
  const works = read('my-novels.html');
  const notes = read('author-notes.html');
  assert.match(works, /work-menu-mobile-only/);
  assert.match(works, /data-novelight-synopsis-lines="2"/);
  assert.match(notes, /align-self:flex-start;white-space:nowrap/);
});

test('novel synopsis folds at runtime without changing its SEO shell', () => {
  const runtime = read('novelight-synopsis-fold.js');
  assert.match(runtime, /novelightSynopsisLines = '3'/);
  assert.match(runtime, /#novelHeader \.description/);
});

test('reader pages provide signed-in bookshelf and profile links', () => {
  assert.match(read('index.html'), /novelight-reader-account\.js/);
  assert.match(read('favorites.html'), /novelight-reader-account\.js/);
  assert.match(read('mypage.html'), /profile-settings\.html/);
  assert.match(read('auth-reader-context.js'), /profile-settings\.html/);
});

test('profile settings reuse owner-authenticated operations', () => {
  const profile = read('novelight-profile-settings.js');
  assert.match(profile, /novelight_update_my_public_profile/);
  assert.match(profile, /novelight_set_scout_badge_visibility/);
  assert.match(profile, /novelight_ensure_my_profile/);
  assert.match(read('profile-settings.html'), /favoriteGenreChoices/);
});

test('new browser code parses', () => {
  const nav = read('novelight-reader-account.js');
  const profile = read('novelight-profile-settings.js');
  assert.doesNotThrow(() => new vm.Script(nav));
  assert.doesNotThrow(() => new vm.Script(profile));
});
