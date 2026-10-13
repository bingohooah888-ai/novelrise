import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const css = read('novelight-audience-features.css');
const supportPage = read('announcements.html');

test('author and reader guides match the announcements light shell', () => {
  for (const name of ['author-features.html', 'reader-features.html']) {
    const html = read(name);
    assert.match(html, /href="legal\.css"/u, name);
    assert.match(html, /href="novelight-header-light\.css"/u, name);
    assert.match(html, /href="novelight-audience-features\.css"/u, name);
    assert.match(html, /href="novelight-accessibility\.css"/u, name);
    assert.match(html, /novelight-public-header-page novelight-support-page/u, name);
    assert.doesNotMatch(html, /novelight-public-dark|novelight-theme\.css/u, name);
    assert.match(html, /class="header-inner public-header-inner"/u, name);
    assert.match(html, /aria-label="NOVELIGHT ホーム"/u, name);
    assert.match(html, /class="site-footer-inner"/u, name);
    assert.match(html, /href="assets\/novelight-header-logo\.webp"/u, name);
    assert.match(html, /href="announcements\.html">お知らせ/u, name);
    assert.match(html, /href="pricing\.html">料金プラン/u, name);
  }
  assert.match(supportPage, /novelight-public-header-page novelight-support-page/u);
});

test('both feature headers use the production session-based auth sync', () => {
  for (const name of ['author-features.html', 'reader-features.html']) {
    const html = read(name);
    const vendor = html.indexOf('src="/assets/vendor/supabase-js-2.112.3.js"');
    const runtime = html.indexOf('src="novelight-client.js"');
    const update = html.indexOf('NovelightClient.syncAuthHeader(audienceAuthClient)');
    assert.ok(vendor >= 0 && runtime > vendor && update > runtime, name);
    assert.match(html, /supabase\.createClient\(/u, name);
    assert.match(html, /class="btn btn-outline login-action"/u, name);
    assert.match(html, /class="btn btn-primary signup-action"/u, name);
    assert.match(html, /class="mobile-login-action"/u, name);
    assert.match(html, /class="mobile-signup-action"/u, name);
  }
});

test('audience styles use ivory cards and dark ink instead of navy', () => {
  assert.match(css, /\.novelight-audience-page\s*\{[^}]*background:\s*#f7f4ed;/u);
  assert.match(css, /\.audience-card\s*\{[^}]*background:\s*#fffdf8;/u);
  assert.match(css, /\.audience-card h3\s*\{[^}]*color:\s*#1b2430;/u);
  assert.match(css, /\.audience-card p\s*\{[^}]*color:\s*#56606e;/u);
  assert.doesNotMatch(css, /background:\s*#06101d|background:\s*#0b1727/u);
});
