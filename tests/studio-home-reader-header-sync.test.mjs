import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = (name) => readFileSync(name, 'utf8');
const home = read('index.html');
const studio = read('mypage.html');
const reader = read('novelight-reader-account.js');
const badge = read('novelight-bookshelf-header.js');
const shell = read('novelight-author-studio-shell.js');

test('Home and Studio share the account renderer', () => {
  assert.match(home, /src="novelight-reader-account\.js"/u);
  assert.match(studio, /data-novelight-reader-account="mypage"/u);
  assert.match(shell, /readerScript\.src = 'novelight-reader-account\.js'/u);
  assert.match(reader, /const isWorkspace = Boolean/u);
  assert.match(reader, /bookshelfLink\(true\), account/u);
  assert.match(reader, /account\.href = 'profile-settings\.html'/u);
  assert.match(reader, /const chip = anchor\('profile-settings\.html'/u);
});

test('Studio badge reuses the shared bookshelf anchor', () => {
  assert.match(reader, /link\.id = 'novelightBookshelfHeaderLink'/u);
  assert.match(reader, /anchor\('favorites\.html', '本棚'/u);
  assert.match(badge, /await window\.NovelightReaderAccount\?\.ready/u);
  assert.match(badge, /if \(link\) \{/u);
  assert.match(badge, /nl-bookshelf-header-badge/u);
});

test('Studio avatar uses the same profile and keeps editor nodes', () => {
  assert.match(reader, /select\('display_name,avatar_path'\)/u);
  assert.match(reader, /storage\.from\('author-avatars'\)/u);
  assert.match(reader, /paintAvatar\(avatar, name, avatarPath, client\)/u);
  assert.match(studio, /id="accountAvatar"/u);
  assert.match(studio, /id="accountName"/u);
  assert.match(shell, /accountAvatar\.id = 'accountAvatar'/u);
  assert.match(studio, /<header class="workspace-top">/u);
  const css = read('novelight-author-room.css');
  assert.match(css, /novelight-author-room-logo\.webp/u);
});

test('modified scripts have valid JavaScript syntax', () => {
  for (const name of [
    'novelight-reader-account.js',
    'novelight-bookshelf-header.js',
    'novelight-author-studio-shell.js'
  ]) {
    assert.doesNotThrow(() => new vm.Script(read(name)));
  }
});
