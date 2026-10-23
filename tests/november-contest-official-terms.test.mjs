import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
import { isContestTermsVisible } from '../api/contest-terms.js';
import { contestPageTemplate } from '../api/_lib/contest-template.js';
import {
  CONTEST_TERMS_URL_CANDIDATE,
  CONTEST_TERMS_VERSION_CANDIDATE,
  contestTermsTemplate
} from '../api/_lib/contest-terms-template.js';

const vercel = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
);
const api = readFileSync(
  new URL('../api/contest-terms.js', import.meta.url),
  'utf8'
);

test('contest terms are not served before explicit contest release', () => {
  const base = {
    status: 'registration',
    public_visible: true,
    terms_version: CONTEST_TERMS_VERSION_CANDIDATE,
    terms_url: CONTEST_TERMS_URL_CANDIDATE
  };
  assert.equal(isContestTermsVisible(null), false);
  assert.equal(
    isContestTermsVisible({ ...base, public_visible: false }),
    false
  );
  assert.equal(isContestTermsVisible({ ...base, status: 'draft' }), false);
  assert.equal(isContestTermsVisible({ ...base, status: 'cancelled' }), false);
  assert.equal(isContestTermsVisible({ ...base, terms_version: '' }), false);
  assert.equal(isContestTermsVisible({ ...base, terms_url: '' }), false);
  assert.equal(
    isContestTermsVisible({ ...base, terms_version: 'other' }),
    false
  );
  assert.equal(isContestTermsVisible(base), true);
  assert.equal(isContestTermsVisible({ ...base, status: 'active' }), true);
  assert.match(api, /status\(404\)/);
  assert.match(api, /no-store/);
});

test('both official terms paths are server-gated', () => {
  for (const path of ['/contest-terms', '/contest-terms.html']) {
    const route = vercel.rewrites.find((item) => item.source === path);
    assert.equal(route?.destination, '/api/contest-terms');
  }
  assert.equal(
    CONTEST_TERMS_URL_CANDIDATE,
    'https://novelight.jp/contest-terms'
  );
});

test('approved contest landing offers a link to the official terms', () => {
  assert.match(contestPageTemplate, /href="\/contest-terms"/);
  assert.match(contestPageTemplate, /正式応募要項/);
});

test('rendered terms show the exact consent version saved by the server', () => {
  assert.equal(CONTEST_TERMS_VERSION_CANDIDATE, 'december-2026-v2');
  assert.ok(contestTermsTemplate.includes(CONTEST_TERMS_VERSION_CANDIDATE));
  assert.match(contestTermsTemplate, /応募要項の版ID/);
});

test('contest terms have visible top and bottom links to the real contest page', () => {
  const cta = '<a href="/contest">星灯祭のコンテストページへ →</a>';
  const occurrences = contestTermsTemplate.split(cta).length - 1;
  assert.equal(occurrences, 2);
  const first = contestTermsTemplate.indexOf(cta);
  const last = contestTermsTemplate.lastIndexOf(cta);
  assert.ok(first < contestTermsTemplate.indexOf('<h2>1. 応募・開催期間</h2>'));
  assert.ok(last > contestTermsTemplate.indexOf('主催者へのお問い合わせ'));
  const route = vercel.rewrites.find((item) => item.source === '/contest');
  assert.equal(route?.destination, '/api/contest-page');
  const css = readFileSync(new URL('../legal.css', import.meta.url), 'utf8');
  assert.match(css, /main\\.legal-container \\.contest-terms-nav a \\{/);
  assert.match(css, /main\\.legal-container \\.contest-terms-nav a:focus-visible/);
});

test('payout retries on failure without duplicate payment', () => {
  const fragments = [
    '振込ができなかった場合',
    '振込後に返金された場合',
    '運営は受賞者に連絡して口座情報を再確認',
    '改めて振込手続き',
    '理由に受賞資格を取り消すことはありません',
    '原則として同じ賞金の再振込は行いません'
  ];
  for (const fragment of fragments) {
    assert.ok(contestTermsTemplate.includes(fragment), fragment);
  }
  assert.doesNotMatch(contestTermsTemplate, /期限後も.*支払|期限後の.*柔軟/);
});

test('public terms reflect decided eligibility and appeal procedure', () => {
  const fragments = [
    '公開10話以上を維持できなかった作品は受賞対象外',
    '不正判定への異議は期限を設けず',
    '運営が再審査して結果をお知らせします'
  ];
  for (const fragment of fragments) {
    assert.ok(contestTermsTemplate.includes(fragment), fragment);
  }
  assert.doesNotMatch(contestTermsTemplate, /異議申立ては7日以内/);
});

test('candidate terms follow adopted contest rules', () => {
  const fragments = [
    '2026年11月30日',
    '2026年12月1日',
    '2027年1月1日',
    '公開済み10話以上',
    '全年齢・R15',
    'R18作品とAI生成主体作品は対象外',
    '有効読了およびポイント集計',
    '通常の読書と共通の有効読書判定',
    '3話以上',
    '1,500文字以上',
    '1pt',
    '5話以上',
    '3,000文字以上',
    '3pt',
    '10話以上',
    '6,000文字以上',
    '5pt',
    '200文字未満',
    '文字数の不自然な水増し',
    '無意味な文章の大量投稿',
    '参加資格の取り消し',
    '有効得点1pt以上',
    '5位境界で同点',
    'BOT',
    '原則自由',
    '通知から1か月以内に返信',
    '返信を受信してから1か月以内',
    '楽天銀行',
    '手数料は運営が負担',
    '明示的に同意',
    '賞金の配布がすべて完了した時点'
  ];
  for (const fragment of fragments) {
    assert.ok(contestTermsTemplate.includes(fragment), fragment);
  }
  assert.match(contestTermsTemplate, /フォームへ投稿しないでください/);
  assert.doesNotMatch(contestTermsTemplate, /非課税|申告不要/);
});
