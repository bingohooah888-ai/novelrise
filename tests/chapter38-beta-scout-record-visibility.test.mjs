import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const mypage = await readFile(new URL('../mypage.html', import.meta.url), 'utf8');
const history = await readFile(
  new URL('../scout-record.html', import.meta.url),
  'utf8'
);

test('beta user navigation exposes LIGHT SEED history instead of SCOUT RECORD', () => {
  assert.doesNotMatch(mypage, /<span>SCOUT RECORD<\/span>/);
  assert.doesNotMatch(mypage, /<h2>SCOUT RECORD<\/h2>/);
  assert.match(mypage, /<span>LIGHT SEED履歴<\/span>/);
  assert.match(mypage, /<h2>LIGHT SEED送信履歴<\/h2>/);
});

test('beta history page stays separate from unreleased SCOUT RECORD feature', () => {
  assert.match(history, /<title>LIGHT SEED送信履歴 \| NOVELIGHT<\/title>/);
  assert.match(history, /<h1>LIGHT SEED送信履歴<\/h1>/);
  assert.match(history, /SCOUT RECORDのLevelやバッジ等は将来提供予定です/);
  assert.doesNotMatch(history, /SCOUTランクやポイントはまだ計算しません/);
  assert.doesNotMatch(history, /<h1>SCOUT RECORD<\/h1>/);
});
