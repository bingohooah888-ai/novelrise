import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { simulateReaderHeader } from '../scripts/header-account-sim.mjs';

const read = (path) => readFileSync(path, 'utf8');
const client = read('novelight-client.js');
const reader = read('novelight-reader-account.js');

test('public headers use a shared account runtime', () => {
  assert.match(client, /function installPublicReaderAccount\(\)/u);
  assert.match(client, /installPublicReaderAccount\(\);/u);
  assert.match(client, /script\.src = 'novelight-reader-account\.js'/u);
  assert.match(client, /slug === 'index' \|\| slug === 'favorites'/u);
  for (const page of [
    'recommended.html',
    'new-arrivals.html',
    'light-seed.html',
    'search.html',
    'ranking.html',
    'novel.html',
    'episode.html',
    'author.html'
  ]) {
    const html = read(page);
    assert.match(html, /novelight-public-header-page/u, page);
    assert.match(html, /src="novelight-client\.js"/u, page);
    assert.match(html, /class="header-actions"/u, page);
  }
});

test('signed-in discovery pages show shelf and avatar', async () => {
  const result = await simulateReaderHeader(
    ['novelight-public-header-page'],
    reader
  );
  const { created, nav } = result;
  assert.equal(created.length, 1);
  const [shelf, profile] = created[0].children;
  assert.equal(shelf.href, 'favorites.html');
  assert.equal(shelf.textContent, '本棚');
  assert.equal(profile.href, 'profile-settings.html');
  const avatar = profile.children[0].children[0];
  assert.equal(avatar.src, 'https://cdn.test/icon.webp');
  assert.equal(profile.children[1].textContent, 'テスト読者');
  assert.equal(nav.children.length, 1);
  assert.equal(nav.children[0].children.length, 2);
});

test('dedicated campaign header remains isolated', async () => {
  const { created, window } = await simulateReaderHeader(
    ['novelight-page-scout-campaign'],
    reader
  );
  assert.equal(created.length, 0);
  assert.equal(window.NovelightReaderAccount, undefined);
});

test('studio gold logo and script syntax stay protected', () => {
  assert.match(reader, /if \(isWorkspace\) \{/u);
  assert.match(reader, /if \(isHome \|\| isPublic\)/u);
  assert.match(read('novelight-author-room.css'), /author-room-logo\.webp/u);
  assert.doesNotThrow(() => new vm.Script(client));
  assert.doesNotThrow(() => new vm.Script(reader));
});
