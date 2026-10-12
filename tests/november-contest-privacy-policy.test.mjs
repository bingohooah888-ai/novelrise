import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const file = new URL('../privacy.html', import.meta.url);
const html = readFileSync(file, 'utf8');

test('contest privacy notice covers reader and bank data', () => {
  assert.match(html, /november-contest-privacy/);
  assert.match(html, /ゲスト読者/);
  assert.match(html, /BOT/);
  assert.match(html, /応募要項への同意版/);
  assert.match(html, /登録されたメールアドレス/);
  assert.match(html, /メール経路で受領/);
  assert.match(html, /国内銀行/);
  assert.match(html, /口座番号/);
});

test('contest privacy notice covers erasure and safeguards', () => {
  assert.match(html, /削除または匿名化/);
  assert.match(html, /バックアップ/);
  assert.match(html, /会計・税務/);
  assert.match(html, /会員アカウント/);
  assert.match(html, /アクセス権の管理/);
  assert.match(html, /公開ページへ入力しない/);
});
