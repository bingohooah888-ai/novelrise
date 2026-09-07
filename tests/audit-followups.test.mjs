import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('CI treats stylesheet and shared browser runtime changes as E2E-relevant', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.ok(
    ci.includes(
      '*.css|novelight-client.js|novelight-discovery-list.js|novelight-thumbnail-runtime.js'
    )
  );
  assert.ok(
    ci.includes(
      '*.html|*.css|novelight-client.js|novelight-discovery-list.js|novelight-thumbnail-runtime.js|tests/e2e/*'
    )
  );
});

test('syntax check covers root browser JavaScript as well as api and scripts', () => {
  const script = read('scripts/check-js-syntax.mjs');
  assert.ok(
    script.includes("const rootFiles = readdirSync('.', { withFileTypes: true })")
  );
  assert.ok(
    script.includes(
      'const files = [...rootFiles, ...roots.flatMap(collectFiles)].sort();'
    )
  );
});

test('login redirect allowlist preserves authenticated creator edit flows', () => {
  const login = read('login.html');
  for (const path of [
    '/novel-edit.html',
    '/episode-post.html',
    '/episode-edit.html'
  ]) {
    assert.ok(
      login.includes(`'${path}'`),
      `${path} must be a safe login redirect target`
    );
  }
  assert.ok(login.includes("return url.pathname.replace(/^\\//,'')+url.search"));
});

test('pricing mobile menu uses login entry for anonymous visitors', () => {
  const pricing = read('pricing.html');
  const mobileMenu =
    pricing.match(/<details class="mobile-menu"[\s\S]*?<\/details>/u)?.[0] || '';
  assert.ok(mobileMenu.includes('<a href="login.html">ログイン</a>'));
  assert.ok(!mobileMenu.includes('<a href="mypage.html">作者ホーム</a>'));
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
    assert.ok(
      html.includes(
        '<link rel="stylesheet" href="novelight-theme.css" data-novelight-theme="sitewide">'
      ),
      `${page} must preload the site theme`
    );
    assert.match(
      html,
      /<body class="novelight-theme novelight-page-[^"]+">/u,
      `${page} must expose its page theme class without JavaScript`
    );
    assert.ok(
      !html.includes('作者ホーム'),
      `${page} must use the current creator-room name`
    );
  }
});
