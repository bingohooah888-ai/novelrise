import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('novelight-discovery-list.css');
const spacingCss = read('novelight-discovery-spacing.css');
const themeCss = read('novelight-theme.css');
const finishCss = read('novelight-reader-parchment-finish.css');
const loginCss = read('novelight-login-parchment.css');

const discoveryPages = [
  'recommended.html',
  'new-arrivals.html',
  'light-seed.html',
];

function headerMarkup(source) {
  const start = source.indexOf('<header');
  const end = source.indexOf('</header>', start);
  assert.ok(start >= 0 && end > start, 'page must contain a header');
  return source.slice(start, end + '</header>'.length);
}

test('discovery pages share visual CSS', () => {
  for (const file of discoveryPages) {
    const html = read(file);
    assert.ok(html.includes('novelight-discovery-list.css'));
    assert.ok(html.includes('novelight-page-discovery-list'));
  }
});

test('discovery pages use the unified public header composition', () => {
  for (const file of discoveryPages) {
    const html = read(file);
    const header = headerMarkup(html);

    assert.ok(
      html.includes('novelight-header-light.css'),
      `${file} loads shared header CSS`,
    );
    assert.ok(
      html.includes('novelight-public-header-page'),
      `${file} opts into shared header`,
    );
    assert.match(header, /aria-label="NOVELIGHT ホーム"/u);
    assert.match(
      header,
      /href="search\.html" aria-current="page">作品を探す</u,
    );
    assert.doesNotMatch(header, />ホーム</u);

    const labels = ['作品を探す', '特徴', '料金プラン', 'ランキング'];
    let previous = -1;
    for (const label of labels) {
      const index = header.indexOf(label);
      assert.ok(index > previous, `${file}: ${label} order`);
      previous = index;
    }

    assert.match(header, /login-action[\s\S]*?>ログイン</u);
    assert.match(header, /signup-action[\s\S]*?>会員登録</u);
  }
});

test('search and ranking use shared visual CSS', () => {
  const search = read('search.html');
  const ranking = read('ranking.html');

  assert.ok(search.includes('novelight-discovery-list.css'));
  assert.ok(search.includes('class="novelight-page-search"'));
  assert.ok(ranking.includes('novelight-discovery-list.css'));
  assert.ok(ranking.includes('class="novelight-page-ranking"'));
});

test('discovery surfaces share compact spacing rules', () => {
  assert.match(themeCss, /novelight-discovery-spacing\.css/u);
  assert.match(spacingCss, /--home-discovery-shelf-gap:\s*24px/u);
  assert.match(spacingCss, /--home-discovery-shelf-gap:\s*18px/u);
  assert.match(
    spacingCss,
    /section\.discovery-section\s*\{[\s\S]*?padding:\s*0\s*!important/u,
  );
  assert.match(
    spacingCss,
    /> \.container\s*\{[\s\S]*?padding-top:[\s\S]*?padding-bottom:/u,
  );
  assert.match(
    spacingCss,
    /section\.discovery-section[\s\S]*?background:\s*#050d18\s*!important/u,
  );
  assert.match(spacingCss, /--discovery-page-space-top:\s*34px/u);
  assert.match(spacingCss, /--discovery-page-space-bottom:\s*46px/u);
  assert.match(spacingCss, /--discovery-page-space-top:\s*20px/u);
  assert.match(spacingCss, /--discovery-page-space-bottom:\s*34px/u);
  assert.match(
    spacingCss,
    /main\.discovery-list-main[\s\S]*?min-height:\s*0\s*!important/u,
  );
  assert.match(
    spacingCss,
    /novelight-page-search,\s*\.novelight-page-ranking\) main[\s\S]*?margin-top:[\s\S]*?margin-bottom:/u,
  );
});

test('shared CSS keeps parchment colors and readable type', () => {
  assert.ok(css.includes('--discovery-paper-1: #f1e5c9'));
  assert.ok(css.includes('--discovery-paper-2: #e6d3ad'));
  assert.ok(css.includes('--discovery-paper-3: #dcc294'));
  assert.ok(
    css.includes(
      'body.novelight-page-discovery-list.novelight-public-dark .discovery-list-copy h1',
    ),
  );
  assert.ok(css.includes('color: #3a2618'));
  assert.ok(css.includes('font-size: clamp(30px, 4vw, 46px)'));
  assert.ok(css.includes('font-size: clamp(30px, 4vw, 42px)'));
  assert.ok(css.includes('font-size: 21px'));
  assert.ok(css.includes('font-size: 19px'));
  assert.ok(css.includes('font-size: 18px'));
});

test('button typography keeps the approved size', () => {
  assert.ok(css.includes('.discovery-list-tabs a {'));
  assert.ok(css.includes('.discovery-list-more {'));
  assert.ok(css.includes('body.novelight-page-search .more {'));
  assert.ok(css.includes('body.novelight-page-ranking .tab {'));
  assert.ok((css.match(/font-size: 16px/g) || []).length >= 4);
});

test('search and ranking use the Home Mincho family and reference background', () => {
  assert.ok(
    loginCss.startsWith('@import url("novelight-reader-parchment-finish.css");'),
  );
  assert.match(
    finishCss,
    /--novelight-reader-brand-font:\s*"Yu Mincho",\s*"Hiragino Mincho ProN",\s*"Hiragino Mincho Pro",\s*"Noto Serif JP",\s*"Noto Serif CJK JP",\s*Georgia,\s*"Times New Roman",\s*serif;/u,
  );
  assert.match(
    finishCss,
    /html body\.novelight-page-search,[\s\S]*?html body\.novelight-page-ranking[\s\S]*?background-color:\s*#080707;[\s\S]*?linear-gradient\(180deg, #120c08 0%, #0b0908 46%, #080707 100%\)/u,
  );
  assert.match(
    finishCss,
    /linear-gradient\(135deg, #f1e5c9 0%, #e6d3ad 52%, #dcc294 100%\)/u,
  );
  assert.match(
    finishCss,
    /font-family:\s*var\(--novelight-reader-brand-font\)/u,
  );
});
