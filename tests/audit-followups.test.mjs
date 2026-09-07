import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('CI treats stylesheet and shared browser runtime changes as E2E-relevant', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /\*\.css\|novelight-client\.js\|novelight-discovery-list\.js\|novelight-thumbnail-runtime\.js/u);
  assert.match(ci, /\*\.html\|\*\.css\|novelight-client\.js\|novelight-discovery-list\.js\|novelight-thumbnail-runtime\.js\|tests\/e2e\/\*/u);
});

test('syntax check covers root browser JavaScript as well as api and scripts', () => {
  const script = read('scripts/check-js-syntax.mjs');
  assert.match(script, /const rootFiles = readdirSync\('\.'\)/u);
  assert.match(script, /const files = \[\.\.\.rootFiles, \.\.\.roots\.flatMap\(collectFiles\)\]/u);
});

test('login redirect allowlist preserves authenticated creator edit flows', () => {
  const login = read('login.html');
  for (const path of ['/novel-edit.html', '/episode-post.html', '/episode-edit.html']) {
    assert.ok(login.includes(`'${path}'`), `${path} must be a safe login redirect target`);
  }
  assert.match(login, /return url\.pathname\.replace\(\/\^\\\/\//u);
});

test('pricing mobile menu uses login entry for anonymous visitors', () => {
  const pricing = read('pricing.html');
  assert.match(pricing, /<details class="mobile-menu"[\s\S]*<a href="login\.html">ログイン<\/a>/u);
  assert.doesNotMatch(pricing, /<details class="mobile-menu"[\s\S]*<a href="mypage\.html">作者ホーム<\/a>/u);
});

test('legacy surfaces preload the NOVELIGHT theme before shared JavaScript runs', () => {
  const pages = [
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
  ];

  for (const page of pages) {
    const html = read(page);
    assert.match(html, /<link rel="stylesheet" href="novelight-theme\.css" data-novelight-theme="sitewide">/u, `${page} must preload the site theme`);
    assert.match(html, /<body class="novelight-theme novelight-page-[^"]+">/u, `${page} must expose its page theme class without JavaScript`);
    assert.doesNotMatch(html, /作者ホーム/u, `${page} must use the current creator-room name`);
  }
});
