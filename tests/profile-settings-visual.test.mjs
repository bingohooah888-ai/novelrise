import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (name) =>
  fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('profile editor uses the same shared header as the homepage', () => {
  const profile = read('profile-settings.html');
  const home = read('index.html');
  const header = /<header class="site-header">[\s\S]*?<\/header>/u;
  assert.equal(profile.match(header)?.[0], home.match(header)?.[0]);
  assert.match(profile, /novelight-public-header-page/u);
  assert.match(profile, /novelight-theme\.css/u);
  assert.match(profile, /← 本棚へ戻る/u);
  assert.match(read('novelight-profile-settings.js'), /syncAuthHeader/u);
});

test('profile hints, status and gold links use readable dark colors', () => {
  const html = read('profile-settings.html');
  assert.match(html, /\.lead\{[^}]*color:#34475b!important/u);
  assert.match(html, /\.hint\{[^}]*color:#435467!important/u);
  assert.match(html, /main a\{color:#76500d/u);
  assert.match(html, /\.status\{[^}]*color:#3a5064!important/u);
});

test('selected genres use light gold with dark lettering', () => {
  const html = read('profile-settings.html');
  assert.match(html, /favorite-genre-choice:has\(input:checked\)/u);
  assert.match(html, /background:#ffedba!important/u);
  assert.match(html, /color:#322510!important/u);
  assert.match(html, /accent-color:#8b631c/u);
  assert.match(read('novelight-profile-favorite-genres.js'), /MAX = 3/u);
});
