import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => readFileSync(name, 'utf8');
const client = read('novelight-client.js');
const firstPaint = read('novelight-header-first-paint.css');
const accessibility = read('novelight-accessibility.css');

test('the shared header styles are present before JavaScript hydration', () => {
  assert.match(accessibility, /novelight-header-light\.css/u);
  assert.match(accessibility, /novelight-header-first-paint\.css/u);
  assert.ok(
    accessibility.indexOf('novelight-header-first-paint.css') <
      accessibility.indexOf('novelight-author-backgrounds.css')
  );
  for (const page of [
    'index.html',
    'pricing.html',
    'recommended.html',
    'new-arrivals.html',
    'light-seed.html',
    'search.html',
    'ranking.html'
  ]) {
    const html = read(page);
    const head = html.split('</head>')[0];
    assert.match(head, /href="novelight-accessibility\.css"/u, page);
    assert.match(html, /src="assets\/novelight-header-logo\.webp"/u, page);
  }
});

test('the initial public viewport reserves the classic scrollbar gutter', () => {
  assert.match(firstPaint, /scrollbar-gutter: stable/u);
  assert.match(firstPaint, /html:has\(> body\.novelight-public-dark\)/u);
});

test('header artwork ratio is reserved and never restyled after paint', () => {
  assert.match(firstPaint, /aspect-ratio: 5 \/ 2/u);
  const install = client.slice(
    client.indexOf('function installBrandLogo()'),
    client.indexOf('installBrandLogo();')
  );
  assert.doesNotMatch(install, /document\.createElement\('style'\)/u);
  assert.doesNotMatch(install, /novelight-brand-logo-style/u);
});

test('search and ranking have a fully styled header in their initial HTML', () => {
  for (const page of ['search.html', 'ranking.html']) {
    const html = read(page);
    const head = html.split('</head>')[0];
    const header = html.match(
      /<header class="site-header">[\s\S]*?<\/header>/u
    )?.[0];
    assert.ok(header, page);
    assert.match(head, /href="novelight-theme\.css"/u, page);
    assert.match(head, /href="novelight-header-light\.css"/u, page);
    assert.match(html, /novelight-public-header-page/u, page);
    assert.match(header, /class="site-nav desktop-nav"/u, page);
    assert.match(header, /class="header-inner public-header-inner"/u, page);
    assert.match(header, /src="assets\/novelight-header-logo\.webp"/u, page);
  }
});

test('the shared header stylesheet is not reinserted after first paint', () => {
  const install = client.slice(
    client.indexOf('function installPublicHeader()'),
    client.indexOf('installPublicHeader();')
  );
  assert.match(install, /const hasHeaderCss =/u);
  assert.match(install, /link\[href="novelight-accessibility\.css"\]/u);
  assert.match(install, /if \(!hasHeaderCss\) \{/u);
  const news = read('news-detail.html');
  assert.match(news, /<header class="site-header">/u);
  assert.match(news, /class="header-inner public-header-inner"/u);
});

test('legacy public reader and auth pages ship their final header in HTML', () => {
  for (const page of [
    'login.html',
    'signup.html',
    'novel.html',
    'episode.html',
    'author.html',
    'news-detail.html'
  ]) {
    const source = read(page);
    const header = source.match(
      /<header class="site-header">[\s\S]*?<\/header>/u
    )?.[0];
    assert.ok(header, page);
    assert.match(source, /novelight-public-header-page/u, page);
    assert.match(header, /class="header-inner public-header-inner"/u, page);
    assert.match(header, /class="site-nav desktop-nav"/u, page);
    assert.match(header, /src="assets\/novelight-header-logo\.webp"/u, page);
    assert.match(
      source.split('</head>')[0],
      /novelight-accessibility\.css/u,
      page
    );
  }
});

test('legacy and announcement pages load their finished theme before paint', () => {
  for (const page of [
    'login.html',
    'signup.html',
    'novel.html',
    'announcements.html',
    'news-detail.html'
  ]) {
    const source = read(page);
    const head = source.split('</head>')[0];
    assert.match(head, /href="novelight-theme\.css"/u, page);
    assert.match(source, /class="novelight-theme /u, page);
  }
});

test('authenticated public headers keep their navigation width', () => {
  assert.match(accessibility, /\.signup-action\[hidden\]/u);
  assert.match(accessibility, /visibility: hidden !important/u);
  assert.match(accessibility, /pointer-events: none !important/u);
  assert.match(client, /signupLink\.dataset\.authState = hidden/u);
  assert.match(client, /signupLink\.setAttribute\('aria-hidden', 'true'\)/u);
});

test('static public headers survive client initialization without replacement', () => {
  assert.match(client, /const staticHeader =/u);
  assert.match(client, /if \(staticHeader\) \{/u);
  assert.match(client, /mobileLogin\.classList\.add\('mobile-login-action'\)/u);
  assert.match(client, /mobileNav\.appendChild\(mobileSignup\)/u);
  const reuse = client.slice(
    client.indexOf('if (staticHeader) {'),
    client.indexOf("header.className = 'site-header';")
  );
  assert.match(reuse, /return true;/u);
  assert.doesNotMatch(reuse, /header\.innerHTML\s*=/u);
  assert.match(client, /header\.innerHTML\s*=/u);
});

test('Home header restores approved ivory', () => {
  const name = 'html body.novelight-public-dark .site-header {';
  const start = accessibility.indexOf(name);
  assert.ok(start >= 0);
  const rule = accessibility.slice(start, accessibility.indexOf('}', start));
  assert.match(rule, /rgba\(250, 249, 246, 0\.98\)/u);
  assert.doesNotMatch(rule, /rgba\(3, 10, 18/u);
});

test('public-dark logo does not use the old gold filter', () => {
  const base = read('novelight-header-light-base.css');
  assert.doesNotMatch(base, /filter: invert\(1\) sepia/u);
  assert.match(accessibility, /mix-blend-mode: normal !important/u);
});

test('admin shortcut has a fixed header slot and a compact-layout fallback', () => {
  const toast = read('novelight-scout-title-toast.js');
  assert.match(toast, /insertBefore\(link, mobileMenu \|\| null\)/u);
  assert.match(toast, /novelight-admin-shortcut-desktop/u);
  assert.match(accessibility, /padding-right: 108px !important/u);
  assert.match(accessibility, /position: absolute !important/u);
  assert.match(accessibility, /min-width: 100px !important/u);
  assert.match(accessibility, /max-width: 1100px/u);
});
