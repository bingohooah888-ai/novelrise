import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function read(name) {
  return fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
}

test('inquiry 69: work cards are compact and keep all actions', () => {
  const html = read('my-novels.html');
  assert.ok(html.includes('data-novelight-synopsis-lines="2"'));
  assert.ok(html.includes('.work-secondary-direct{display:none!important}'));
  assert.ok(html.includes('.work-menu-mobile-only{display:flex!important}'));
  assert.ok(html.includes('work-menu-mobile-only" href="work-cover.html'));
  assert.ok(html.includes('work-menu-mobile-only" href="characters.html'));
});

test('inquiry 69: canonical novel shell uses dynamic synopsis folding', () => {
  const html = read('novel.html');
  const fold = read('novelight-synopsis-fold.js');
  assert.ok(html.includes('src="novelight-synopsis-fold.js"'));
  assert.ok(fold.includes("description.dataset.novelightSynopsisLines = '3'"));
  assert.ok(fold.includes('#novelHeader .description'));
  assert.ok(fold.includes('あらすじをもっと見る'));
});

test('inquiry 69: note badge remains compact beside wrapped title', () => {
  const html = read('author-notes.html');
  assert.ok(html.includes('.note-top{display:flex;align-items:flex-start'));
  assert.ok(html.includes('align-self:flex-start;white-space:nowrap'));
  assert.ok(html.includes('overflow-wrap:anywhere'));
});

test('inquiry 69: home and bookshelf link to reader profile', () => {
  const home = read('index.html');
  const shelf = read('favorites.html');
  const nav = read('novelight-reader-account.js');
  const redirects = read('auth-reader-context.js');
  assert.ok(home.includes('src="novelight-reader-account.js"'));
  assert.ok(shelf.includes('src="novelight-reader-account.js"'));
  assert.ok(nav.includes("anchor('favorites.html', '本棚'"));
  assert.ok(nav.includes("anchor('profile-settings.html'"));
  assert.ok(nav.includes('.mobile-menu nav'));
  assert.ok(nav.includes('auth.getSession()'));
  assert.ok(redirects.includes("'/profile-settings.html'"));
  assert.ok(read('mypage.html').includes('href="profile-settings.html"'));
});

test('inquiry 69: profile editing uses existing secured operations', () => {
  const page = read('profile-settings.html');
  const script = read('novelight-profile-settings.js');
  const ids = [
    'avatarInput',
    'displayName',
    'bio',
    'favoriteGenreChoices',
    'favoriteGenreCount',
    'favoriteGenresPublic',
    'saveFavoriteGenres',
    'favoriteGenreStatus',
    'equippedBadge'
  ];
  for (const id of ids) {
    assert.ok(page.includes('id="' + id + '"'), 'missing ' + id);
  }
  assert.ok(script.includes('auth.getSession()'));
  assert.ok(script.includes('novelight_update_my_public_profile'));
  assert.ok(script.includes('novelight_ensure_my_profile'));
  assert.ok(script.includes('novelight_set_scout_badge_visibility'));
  assert.ok(script.includes("storage.from('author-avatars')"));
  assert.ok(page.includes('novelight-profile-favorite-genres.js'));
  assert.doesNotMatch(script, /service_role|SECRET_KEY|SUPABASE_SERVICE/);
});

test('inquiry 69: new runtime scripts parse', () => {
  const names = [
    'novelight-reader-account.js',
    'novelight-profile-settings.js'
  ];
  for (const name of names) {
    assert.doesNotThrow(() => new vm.Script(read(name), { filename: name }));
  }
});
