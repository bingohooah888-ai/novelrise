import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');
const client = read('novelight-client.js');
const pages = [
  'index.html',
  'pricing.html',
  'special-light.html',
  'special-zone.html',
  'search.html',
  'ranking.html',
  'novel.html',
  'episode.html',
  'author.html',
  'login.html',
  'signup.html',
  'announcements.html',
  'contact.html',
  'news-detail.html',
  'recommended.html',
  'new-arrivals.html',
  'light-seed.html'
];

test('all shared public headers ship completed markup and blocking styles', () => {
  for (const page of pages) {
    const source = read(page);
    const head = source.split('</head>')[0];
    const header = source.match(/<header\b[^>]*>[\s\S]*?<\/header>/u)?.[0] ?? '';
    const body = source.match(/<body\b[^>]*>/u)?.[0] ?? '';
    assert.match(head, /data-novelight-theme="sitewide"/u, page);
    assert.match(head, /data-novelight-public-header="shared"/u, page);
    assert.match(body, /novelight-theme/u, page);
    assert.match(body, /novelight-public-(?:header-page|dark)/u, page);
    assert.match(header, /class="header-inner public-header-inner"/u, page);
    assert.match(header, /class="site-nav desktop-nav"/u, page);
    assert.match(header, /class="header-actions"/u, page);
    assert.match(header, /class="mobile-menu"/u, page);
    assert.match(header, /src="assets\/novelight-header-logo\.webp"/u, page);
  }
});

test('preloaded header styling is not redundantly appended after paint', () => {
  assert.match(client, /const hasFirstPaintCss =/u);
  assert.match(client, /novelight-accessibility\.css/u);
  assert.match(client, /!document\.getElementById\(styleId\) && !hasFirstPaintCss/u);
  assert.match(client, /link\[data-novelight-public-header\]/u);
  assert.match(client, /link\[data-novelight-theme="sitewide"\]/u);
});
