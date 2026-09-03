import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = readFileSync(join(root, 'novelight-client.js'), 'utf8');
const headerCss = readFileSync(join(root, 'novelight-header-light.css'), 'utf8');
const staticPublicPages = [
  'terms.html',
  'privacy.html',
  'content-guidelines.html',
  'billing-policy.html',
  'commerce-disclosure.html',
  'contact.html'
];

function headerMarkup(source) {
  const start = source.indexOf('<header');
  const end = source.indexOf('</header>', start);
  assert.ok(start >= 0 && end > start, 'page must contain a header');
  return source.slice(start, end + '</header>'.length);
}

test('shared runtime public header removes the redundant Home item and keeps the requested order', () => {
  assert.match(client, /function installPublicHeader\(\)/u);
  assert.match(client, /novelight-public-header-page/u);
  assert.match(client, /aria-label="NOVELIGHT ホーム"/u);

  const start = client.indexOf('header.innerHTML =');
  const end = client.indexOf('return true;', start);
  const markup = client.slice(start, end);
  const labels = ['作品を探す', '特徴', '料金プラン', 'ランキング'];
  let previous = -1;
  for (const label of labels) {
    const index = markup.indexOf(label);
    assert.ok(index > previous, `${label} must follow the requested desktop order`);
    previous = index;
  }

  assert.doesNotMatch(markup, />ホーム</u);
  assert.match(markup, /class="header-search"[\s\S]*?href="search\.html"/u);
  assert.match(markup, /login-action[\s\S]*?>ログイン</u);
  assert.match(markup, /signup-action[\s\S]*?>会員登録</u);
});

test('reader and anonymous-account pages are routed through the shared public header', () => {
  for (const slug of [
    'index',
    'pricing',
    'search',
    'ranking',
    'novel',
    'episode',
    'author',
    'login',
    'signup',
    'forgot-password',
    'reset-password'
  ]) {
    assert.match(client, new RegExp(`'${slug}'`, 'u'));
  }

  const publicSet = client.slice(
    client.indexOf('const PUBLIC_HEADER_PAGES'),
    client.indexOf('let memoryVisitorToken')
  );
  for (const privateSlug of ['mypage', 'my-novels', 'analytics', 'admin']) {
    assert.doesNotMatch(publicSet, new RegExp(`'${privateSlug}'`, 'u'));
  }
});

test('shared light header CSS gives non-dark public pages the pricing-style composition', () => {
  assert.match(
    headerCss,
    /novelight-public-header-page:not\(\.novelight-public-dark\) \.public-header-inner/u
  );
  assert.match(headerCss, /grid-template-columns:\s*auto minmax\(520px, 1fr\) auto\s*!important/u);
  assert.match(headerCss, /height:\s*104\.4px\s*!important/u);
  assert.match(headerCss, /font-size:\s*18px\s*!important/u);
  assert.match(headerCss, /font-size:\s*19px\s*!important/u);
  assert.match(headerCss, /@media \(max-width: 900px\)[\s\S]*?\.mobile-menu \{[\s\S]*?display:\s*block/u);
});

test('legal and support pages use the same full public navigation instead of a back-only header', () => {
  for (const name of staticPublicPages) {
    const source = readFileSync(join(root, name), 'utf8');
    const header = headerMarkup(source);
    assert.match(source, /href="novelight-header-light\.css"/u, `${name} loads shared header CSS`);
    assert.match(source, /class="novelight-public-header-page"/u, `${name} opts into shared header`);
    assert.match(header, /aria-label="NOVELIGHT ホーム"/u, `${name} logo is the Home control`);
    assert.match(header, />作品を探す</u);
    assert.match(header, />特徴</u);
    assert.match(header, />料金プラン</u);
    assert.match(header, />ランキング</u);
    assert.match(header, />ログイン</u);
    assert.match(header, />会員登録</u);
    assert.doesNotMatch(header, /トップへ戻る|トップページ|← 料金プラン/u);
    assert.doesNotMatch(header, />ホーム</u);
  }
});
