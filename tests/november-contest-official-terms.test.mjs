import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
import { isContestTermsVisible } from '../api/contest-terms.js';
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

test('candidate terms follow adopted contest rules', () => {
  const fragments = [
    '2026年10月31日',
    '2026年11月1日',
    '2026年12月1日',
    '公開済み10話以上',
    '全年齢・R15',
    'R18作品とAI生成主体作品は対象外',
    '0〜2話：0pt',
    '3〜4話：合計1pt',
    '5〜9話：合計3pt',
    '10話以上：合計5pt',
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
  assert.match(contestTermsTemplate, /一般お問い合わせフォームへ投稿しないでください/);
  assert.doesNotMatch(contestTermsTemplate, /賞金は非課税|申告不要/);
});
