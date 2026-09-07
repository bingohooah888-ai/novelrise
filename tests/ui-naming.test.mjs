import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlFiles = readdirSync(root)
  .filter((name) => name.endsWith('.html'))
  .sort();

const forbidden = [
  'NovelRise',
  'Novel Rise',
  'ライトシード',
  'スカウト履歴',
  '作者ダッシュボード',
  '作者ホーム'
];

test('user-facing HTML uses NOVELIGHT and current beta feature names', () => {
  for (const name of htmlFiles) {
    const html = readFileSync(join(root, name), 'utf8');
    for (const word of forbidden) {
      assert.equal(
        html.includes(word),
        false,
        `${name} still contains deprecated wording: ${word}`
      );
    }
  }
});

test('core pages expose the approved beta terminology', () => {
  const index = readFileSync(join(root, 'index.html'), 'utf8');
  const mypage = readFileSync(join(root, 'mypage.html'), 'utf8');
  const scout = readFileSync(join(root, 'scout-record.html'), 'utf8');
  const pricing = readFileSync(join(root, 'pricing.html'), 'utf8');

  assert.match(index, /NOVELIGHT/u);
  assert.match(index, /LIGHT SEED/u);
  assert.match(mypage, /創作室/u);
  assert.match(mypage, /LIGHT ANALYTICS/u);
  assert.match(scout, /SCOUT RECORD/u);
  assert.match(pricing, /href="login\.html">ログイン/u);
  assert.doesNotMatch(pricing, /href="mypage\.html">作者ホーム/u);
});
