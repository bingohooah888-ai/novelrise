import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('CI watches CSS and shared browser runtimes', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /\*\.css\|novelight-client\.js\|novelight-discovery-list\.js\|novelight-thumbnail-runtime\.js/u);
  assert.match(ci, /\*\.html\|\*\.css\|novelight-client\.js\|novelight-discovery-list\.js\|novelight-thumbnail-runtime\.js\|tests\/e2e\/\*/u);
});

test('syntax check covers root browser JavaScript', () => {
  const script = read('scripts/check-js-syntax.mjs');
  assert.match(script, /const rootFiles = readdirSync\('\.'\)/u);
  assert.match(script, /\.\.\.rootFiles/u);
});

test('login preserves creator edit redirects', () => {
  const login = read('login.html');
  assert.match(login, /'\/novel-edit\.html'/u);
  assert.match(login, /'\/episode-post\.html'/u);
  assert.match(login, /'\/episode-edit\.html'/u);
  assert.match(login, /url\.pathname\.replace/u);
});

test('pricing anonymous mobile entry is login', () => {
  const pricing = read('pricing.html');
  const mobile = pricing.match(/<details class="mobile-menu"[\s\S]*?<\/details>/u)?.[0] || '';
  assert.match(mobile, /href="login\.html">ログイン/u);
  assert.doesNotMatch(mobile, /href="mypage\.html">作者ホーム/u);
});

test('legacy surfaces preload the NOVELIGHT theme', () => {
  for (const page of [
    'post.html',
    'novel-edit.html',
    'episode-post.html',
    'episode-edit.html',
    'my-novels.html',
    'analytics.html',
    'scout-record.html',
    'favorites.html',
    'author.html',
    'episode.html'
  ]) {
    const html = read(page);
    assert.match(html, /href="novelight-theme\.css" data-novelight-theme="sitewide"/u);
    assert.match(html, /<body class="novelight-theme novelight-page-[^"]+">/u);
    assert.doesNotMatch(html, /作者ホーム/u);
  }
});
