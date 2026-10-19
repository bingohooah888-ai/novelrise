import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (name) =>
  fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');

function contrast(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.match(/[0-9a-f]{2}/giu).map((item) => {
      const v = Number.parseInt(item, 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return (
      channels[0] * 0.2126 +
      channels[1] * 0.7152 +
      channels[2] * 0.0722
    );
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('profile editor uses the standard NOVELIGHT public header and auth state', () => {
  const html = read('profile-settings.html');
  const home = read('index.html');
  const client = read('novelight-client.js');
  const runtime = read('novelight-profile-settings.js');
  const shell = (source) =>
    source.match(/<header class="site-header">[\s\S]*?<\/header>/u)?.[0];
  assert.equal(shell(html), shell(home));
  assert.match(html, /novelight-public-header-page novelight-page-profile-settings/u);
  assert.match(html, /novelight-theme\.css/u);
  assert.match(html, /<a href="favorites\.html">← 本棚へ戻る<\/a>/u);
  assert.match(client, /'profile-settings'/u);
  assert.match(runtime, /NovelightClient\.syncAuthHeader\(client\)/u);
});

test('profile editor maintains readable colors for secondary copy and links', () => {
  const html = read('profile-settings.html');
  assert.match(html, /\.lead\{[^}]*color:#34475b!important/u);
  assert.match(html, /\.hint\{[^}]*color:#435467!important/u);
  assert.match(html, /main a\{color:#76500d/u);
  assert.ok(contrast('#34475b', '#f7f4ed') >= 4.5);
  assert.ok(contrast('#435467', '#fffdf8') >= 4.5);
  assert.ok(contrast('#76500d', '#fffdf8') >= 4.5);
});

test('checked favorite genres stay legible on a warm ivory surface', () => {
  const html = read('profile-settings.html');
  assert.match(html, /favorite-genre-choice:has\(input:checked\)/u);
  assert.match(html, /background:#ffedba!important/u);
  assert.match(html, /color:#322510!important/u);
  assert.match(html, /\.favorite-genre-choice input\{[^}]*accent-color:#8b631c/u);
  assert.ok(contrast('#322510', '#ffedba') >= 4.5);
  assert.match(read('novelight-profile-favorite-genres.js'), /MAX = 3/u);
});
