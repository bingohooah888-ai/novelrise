import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const operator = read('operator.html');
const beta = read('beta-authors.html');
const commerce = read('commerce-disclosure.html');
const privacy = read('privacy.html');
const legalCss = read('legal.css');

const publicPages = [
  'index.html',
  'pricing.html',
  'search.html',
  'ranking.html',
  'terms.html',
  'privacy.html',
  'commerce-disclosure.html',
  'contact.html',
  'beta-authors.html'
];

const preregTrustPages = [
  'operator.html',
  'terms.html',
  'privacy.html',
  'commerce-disclosure.html',
  'contact.html'
];

test('operator information is public, complete, and aligned with the NOVELIGHT source of truth', () => {
  assert.match(operator, /<title>運営者情報 \| NOVELIGHT<\/title>/);
  assert.match(operator, /サービス名[\s\S]*NOVELIGHT/);
  assert.match(operator, /小説投稿プラットフォーム/);
  assert.match(operator, /β版公開予定日[\s\S]*2026年9月30日/);
  assert.match(operator, /作品が評価される前の段階にある機会格差を減らし/);
  assert.match(operator, /知名度だけで作品の発見機会が決まらないよう/);
  assert.match(
    operator,
    /課金で買えるのは「評価」ではなく、評価される「機会」まで。/
  );
  assert.match(operator, /href="contact\.html"/);
  assert.match(operator, /href="terms\.html"/);
  assert.match(operator, /href="privacy\.html"/);
  assert.match(operator, /href="commerce-disclosure\.html"/);
  assert.doesNotMatch(operator, /location\.href\s*=\s*['"]login\.html/);
});

test('major logged-out public pages expose operator information in one click', () => {
  for (const path of publicPages) {
    const html = read(path);
    assert.match(
      html,
      /href="operator\.html"/,
      `${path} must link to operator.html`
    );
  }
});

test('preregistration trust links are visible before the registration submit button', () => {
  const submitIndex = beta.indexOf('id="submitButton"');
  assert.ok(submitIndex > 0, 'preregistration submit button must exist');

  for (const href of ['operator.html', 'privacy.html', 'terms.html']) {
    const linkIndex = beta.indexOf(`href="${href}"`);
    assert.ok(
      linkIndex >= 0 && linkIndex < submitIndex,
      `${href} must be linked before submit`
    );
  }

  assert.match(beta, /const API_PATH='\/api\/beta-author-preregistration'/);
  assert.match(
    beta,
    /href="commerce-disclosure\.html">特定商取引法に基づく表記<\/a>/
  );
});

test('preregistration trust and legal pages do not expose main application navigation', () => {
  for (const path of preregTrustPages) {
    assert.match(read(path), /href="legal\.css"/, `${path} must use legal.css`);
  }

  assert.match(
    legalCss,
    /body\.novelight-public-header-page \.site-header \.header-inner,[\s\S]*display: none !important;/
  );

  for (const href of [
    'index.html',
    'search.html',
    'pricing.html',
    'ranking.html',
    'login.html',
    'signup.html',
    'author-home.html',
    'reader-home.html',
    'novel.html',
    'novels.html'
  ]) {
    const escaped = href.replace('.', '\\.');
    assert.match(
      legalCss,
      new RegExp(`\\.legal-main a\\[href\\^="${escaped}"\\]`),
      `${href} must be suppressed on the preregistration trust surface`
    );
  }
});

test('existing disclosure-on-request legal policy remains intact', () => {
  assert.match(
    commerce,
    /消費者から請求があった場合、法令に従い遅滞なく開示します。/
  );
  assert.match(commerce, /特定商取引法に基づく表示事項の開示請求/);
  assert.match(
    privacy,
    /本人から求めがあった場合、法令に従い遅滞なく回答します。/
  );
  assert.match(privacy, /NOVELIGHTお問い合わせフォーム/);
});
