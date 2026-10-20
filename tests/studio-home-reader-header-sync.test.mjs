import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = (name) => readFileSync(name, 'utf8');
const home = source('index.html');
const studio = source('mypage.html');
const readerAccount = source('novelight-reader-account.js');
const bookshelf = source('novelight-bookshelf-header.js');
const studioShell = source('novelight-author-studio-shell.js');

test('home and studio share reader account and bookshelf logic', () => {
  assert.match(home, /src="novelight-reader-account\.js"/u);
  assert.match(
    studio,
    /src="novelight-reader-account\.js" data-novelight-reader-account="mypage"/u
  );
  assert.match(
    studioShell,
    /readerScript\.src = 'novelight-reader-account\.js'/u
  );
  assert.match(
    readerAccount,
    /const isWorkspace = Boolean\(document\.querySelector\('\.workspace-top'\)\)/u
  );
  assert.match(
    readerAccount,
    /if \(isHome\) bar\.appendChild\(bookshelfLink\(\)\)/u
  );
  assert.match(
    readerAccount,
    /bar\.append\(bookshelfLink\(true\), account\)/u
  );
  assert.match(
    readerAccount,
    /const link = anchor\('favorites\.html', '本棚', 'nl-reader-nav-link'\)/u
  );
  assert.match(readerAccount, /account\.href = 'profile-settings\.html'/u);
  assert.match(
    readerAccount,
    /const chip = anchor\('profile-settings\.html'/u
  );
});

test('studio badge augments a single shared bookshelf link', () => {
  assert.match(bookshelf, /await window\.NovelightReaderAccount\?\.ready/u);
  assert.match(bookshelf, /if \(link\) \{/u);
  assert.match(
    bookshelf,
    /!link\.querySelector\('\.nl-bookshelf-header-badge'\)/u
  );
  assert.match(readerAccount, /link\.id = 'novelightBookshelfHeaderLink'/u);
  assert.match(studio, /novelight-bookshelf-header\.js/u);
  assert.match(studioShell, /loadStudioBookshelfBadge/u);
});

test('studio avatar shares the home profile and keeps edit nodes', () => {
  assert.match(readerAccount, /\.select\('display_name,avatar_path'\)/u);
  assert.match(readerAccount, /client\.storage\.from\('author-avatars'\)/u);
  assert.match(
    readerAccount,
    /paintAvatar\(avatar, name, avatarPath, client\)/u
  );
  assert.match(readerAccount, /nameNode\.textContent = name/u);
  assert.match(studio, /id="accountAvatar"/u);
  assert.match(studio, /id="accountName"/u);
  assert.match(studioShell, /accountAvatar\.id = 'accountAvatar'/u);
  assert.match(studio, /<header class="workspace-top">/u);
  assert.match(
    source('novelight-author-room.css'),
    /novelight-author-room-logo\.webp/u
  );
});

test('modified scripts parse without a live session', () => {
  for (const name of [
    'novelight-reader-account.js',
    'novelight-bookshelf-header.js',
    'novelight-author-studio-shell.js'
  ]) {
    assert.doesNotThrow(() => new vm.Script(source(name), { filename: name }));
  }
});
