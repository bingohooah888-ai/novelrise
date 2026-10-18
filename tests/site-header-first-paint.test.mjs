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
