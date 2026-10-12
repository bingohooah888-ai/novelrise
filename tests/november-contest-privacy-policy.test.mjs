import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const privacyFile = new URL('../privacy.html', import.meta.url);
const privacy = readFileSync(privacyFile, 'utf8');

test('November contest reader and prize data purposes are disclosed', () => {
  assert.match(privacy, /id="november-contest-privacy"/);
  assert.match(privacy, /ゲスト読者も集計対象/);
  assert.match(privacy, /BOT・複数サブアカウント/);
  assert.match(privacy, /応募要項への同意版および同意日時/);
  assert.match(privacy, /登録されたメールアドレス宛て/);
  assert.match(privacy, /振込先情報は運営が案内するメール経路で受領/);
  assert.match(privacy, /国内銀行への振込に必要な銀行名/);
});

test('contest data deletion respects mandatory retention', () => {
  assert.match(privacy, /賞金の配布と必要な事後対応が完了した時点/);
  assert.match(privacy, /削除または匿名化/);
  assert.match(privacy, /受信・送信メール、添付資料、作業用の複製やバックアップ/);
  assert.match(privacy, /法令に基づく会計・税務資料の保存/);
  assert.match(privacy, /通常の会員アカウントや一般サービスの利用履歴/);
});

test('financial details are not requested through public forms', () => {
  assert.match(privacy, /一般のお問い合わせフォームや公開ページへ入力しない/);
  assert.match(privacy, /取扱担当者の限定、アクセス権の管理/);
  assert.match(privacy, /href="contact.html"/);
});
