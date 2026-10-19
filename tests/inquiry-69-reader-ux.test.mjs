import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import vm from 'node:vm';

const read = (name) =>
  fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('inquiry #69: mobile work cards remain compact with secondary actions available', () => {
  const html = read('my-novels.html');
  assert.match(html, /data-novelight-synopsis-lines="2"/);
  assert.match(html, /@media\(max-width:640px\)/);
  assert.match(html, /\.work-secondary-direct\{display:none!important\}/);
  assert.match(html, /\.work-menu-mobile-only\{display:flex!important\}/);
  assert.match(html, /work-menu-mobile-only" href="work-cover\.html/);
  assert.match(html, /work-menu-mobile-only" href="characters\.html/);
});

test('inquiry #69: work detail uses the existing three-line synopsis expander', () => {
  const html = read('novel.html');
  const folding = read('novelight-synopsis-fold.js');
  assert.match(html, /class="description" data-novelight-synopsis data-novelight-synopsis-lines="3"/);
  assert.match(html, /src="novelight-synopsis-fold\.js"/);
  assert.match(folding, /あらすじをもっと見る/);
});

test('inquiry #69: note status pill keeps its own height when title wraps', () => {
  const html = read('author-notes.html');
  assert.match(html, /\.note-top\{display:flex;align-items:flex-start/);
  assert.match(html, /\.note-top \.tag\{align-self:flex-start;white-space:nowrap\}/);
  assert.match(html, /\.note h3\{[^}]*overflow-wrap:anywhere/);
});

test('inquiry #69: signed-in reader navigation reaches bookshelf and profile from home and bookshelf', () => {
  const home = read('index.html');
  const bookshelf = read('favorites.html');
  const nav = read('novelight-reader-account.js');
  const auth = read('auth-reader-context.js');
  const studio = read('mypage.html');
  assert.match(home, /src="novelight-reader-account\.js"/);
  assert.match(bookshelf, /src="novelight-reader-account\.js"/);
  assert.match(nav, /anchor\('favorites\.html', '本棚'/);
  assert.match(nav, /anchor\('profile-settings\.html'/);
  assert.match(nav, /\.mobile-menu nav/);
  assert.match(nav, /auth\.getSession\(\)/);
  assert.match(auth, /'\/profile-settings\.html'/);
  assert.match(studio, /href="profile-settings\.html"/);
});

test('inquiry #69: profile editor uses existing owner-authenticated storage and RPCs', () => {
  const page = read('profile-settings.html');
  const script = read('novelight-profile-settings.js');
  const nav = read('novelight-reader-account.js');
  for (const id of [
    'avatarInput', 'displayName', 'bio', 'favoriteGenreChoices',
    'favoriteGenreCount', 'favoriteGenresPublic', 'saveFavoriteGenres',
    'favoriteGenreStatus', 'equippedBadge'
  ]) {
    assert.ok(page.includes('id="' + id + '"'), 'missing ' + id);
  }
  assert.match(script, /auth\.getSession\(\)/);
  assert.match(script, /novelight_update_my_public_profile/);
  assert.match(script, /novelight_ensure_my_profile/);
  assert.match(script, /novelight_set_scout_badge_visibility/);
  assert.match(script, /storage\.from\('author-avatars'\)/);
  assert.match(script, /redirect=profile-settings\.html/);
  assert.match(page, /novelight-profile-favorite-genres\.js/);
  assert.doesNotMatch(script, /service_role|SECRET_KEY|SUPABASE_SERVICE/);
  assert.doesNotMatch(nav, /service_role|SECRET_KEY|SUPABASE_SERVICE/);
});

test('inquiry #69: new browser scripts parse', () => {
  for (const name of [
    'novelight-reader-account.js',
    'novelight-profile-settings.js'
  ]) {
    assert.doesNotThrow(() => new vm.Script(read(name), { filename: name }));
  }
});
