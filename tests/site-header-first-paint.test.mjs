import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => readFileSync(name, 'utf8');
const client = read('novelight-client.js');
const firstPaint = read('novelight-header-first-paint.css');
const accessibility = read('novelight-accessibility.css');

function canonicalCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\s+/gu, '')
    .replaceAll(';}', '}');
}

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
    'light-seed.html'
  ]) {
    const html = read(page);
    const head = html.split('</head>')[0];
    assert.match(head, /href="novelight-accessibility\.css"/u, page);
    assert.match(html, /src="assets\/novelight-header-logo\.webp"/u, page);
  }
});

test('the first-paint logo CSS and the runtime fallback cannot diverge', () => {
  const start = client.indexOf('style.textContent =');
  const end = client.indexOf('document.head.appendChild(style);', start);
  assert.ok(start >= 0 && end > start);
  const parts = client.slice(start, end).match(/'(?:\\.|[^'\\])*'/gu) || [];
  const runtimeCss = parts
    .map((part) => part.slice(1, -1).replace(/\\(.)/gu, '$1'))
    .join('');
  assert.ok(runtimeCss.length > 3000);
  assert.equal(canonicalCss(firstPaint), canonicalCss(runtimeCss));
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
