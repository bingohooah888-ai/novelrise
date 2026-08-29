import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

async function read(page) {
  return readFile(path.join(repoRoot, page), 'utf8');
}

function localHtmlTargets(source) {
  const targets = new Set();
  const hrefPattern = /\bhref=(["'])([^"']+)\1/gu;

  for (const match of source.matchAll(hrefPattern)) {
    const href = match[2].trim();
    if (
      !href ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:') ||
      /^(?:https?:)?\/\//u.test(href)
    ) {
      continue;
    }

    const target = href
      .split(/[?#]/u, 1)[0]
      .replace(/^\.\//u, '')
      .replace(/^\//u, '');
    if (target.endsWith('.html')) targets.add(target);
  }

  return targets;
}

test('root HTML links do not point to missing local HTML pages', async () => {
  const rootEntries = await readdir(repoRoot, { withFileTypes: true });
  const htmlFiles = rootEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name)
    .sort();
  const htmlSet = new Set(htmlFiles);

  for (const page of htmlFiles) {
    const source = await read(page);
    for (const target of localHtmlTargets(source)) {
      assert.ok(
        htmlSet.has(target),
        `${page} links to missing local page ${target}`
      );
    }
  }
});

const requiredStaticLinks = new Map([
  [
    'index.html',
    ['signup.html', 'search.html', 'post.html', 'ranking.html', 'pricing.html']
  ],
  [
    'login.html',
    [
      'index.html',
      'forgot-password.html',
      'signup.html',
      'terms.html',
      'privacy.html',
      'contact.html'
    ]
  ],
  [
    'signup.html',
    [
      'index.html',
      'login.html',
      'terms.html',
      'privacy.html',
      'content-guidelines.html',
      'commerce-disclosure.html',
      'contact.html'
    ]
  ],
  [
    'mypage.html',
    [
      'index.html',
      'post.html',
      'my-novels.html',
      'analytics.html',
      'scout-record.html',
      'pricing.html'
    ]
  ],
  ['my-novels.html', ['index.html', 'mypage.html', 'post.html']],
  [
    'pricing.html',
    [
      'index.html',
      'mypage.html',
      'billing-policy.html',
      'terms.html',
      'commerce-disclosure.html',
      'privacy.html',
      'contact.html'
    ]
  ]
]);

test('beta-critical static navigation stays available', async () => {
  for (const [page, requiredTargets] of requiredStaticLinks) {
    const targets = localHtmlTargets(await read(page));
    for (const target of requiredTargets) {
      assert.ok(targets.has(target), `${page} must keep a link to ${target}`);
    }
  }
});

const requiredDynamicTargets = new Map([
  ['search.html', ['novel.html?id=']],
  ['ranking.html', ['novel.html?id=']],
  ['author.html', ['novel.html?id=']],
  ['favorites.html', ['novel.html?id=', 'login.html?redirect=favorites.html']],
  ['my-novels.html', ['novel.html?id=']],
  [
    'novel.html',
    [
      'author.html?id=',
      'episode.html?id=',
      'novel-edit.html?id=',
      'episode-post.html?novel_id=',
      'my-novels.html'
    ]
  ],
  ['episode.html', ['novel.html?id=', 'episode-edit.html?id=']]
]);

test('beta-critical data-driven navigation targets stay wired', async () => {
  for (const [page, requiredTargets] of requiredDynamicTargets) {
    const source = await read(page);
    for (const target of requiredTargets) {
      assert.ok(
        source.includes(target),
        `${page} must keep navigation to ${target}`
      );
    }
  }
});
