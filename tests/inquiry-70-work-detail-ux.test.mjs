import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('full novel synopsis remains expandable when WebKit clamp cannot measure overflow', () => {
  const source = read('novelight-synopsis-fold.js');
  assert.match(source, /clippedScrollHeight/u);
  assert.match(source, /substantialNovelSynopsis/u);
  assert.match(source, /paragraphCount > lineLimit\(host\)/u);
  assert.match(source, /host\.classList\.toggle\('is-expanded'\)/u);
  assert.match(source, /\.nl-synopsis-copy\{display:block;white-space:pre-wrap;overflow-wrap:anywhere;\}/u);
  assert.match(source, /text\.split\(\/\\r\?\\n\/u\)/u);
  assert.doesNotThrow(() => new vm.Script(source));
});

test('studio profile title and its links wrap rather than crowd each other', () => {
  const css = read('novelight-author-home.css');
  const page = read('mypage.html');
  assert.match(css, /\.profile-panel \.panel-header\{[\s\S]*?flex-wrap:wrap/u);
  assert.match(css, /\.profile-panel \.panel-header h2\{[\s\S]*?flex:1 0 100%/u);
  assert.match(css, /\.profile-panel \.panel-header \.section-link\{[\s\S]*?white-space:normal/u);
  assert.match(page, /id="profileHeading">プロフィール設定/u);
});

test('phone work page keeps its reading content and author controls inside the viewport', () => {
  const css = read('novelight-theme.css');
  assert.match(css, /body\.novelight-page-novel #novelHeader \.title\s*\{[^}]*overflow-wrap: anywhere/u);
  assert.match(css, /body\.novelight-page-novel #ownerActionsTop \.owner-core,[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.match(css, /body\.novelight-page-novel #episodesPanel\s*\{[^}]*padding: 20px 17px/u);
});
