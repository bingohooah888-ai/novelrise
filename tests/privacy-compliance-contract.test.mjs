import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const privacy = readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');
const contact = readFileSync(new URL('../contact.html', import.meta.url), 'utf8');
const betaAuthors = readFileSync(
  new URL('../beta-authors.html', import.meta.url),
  'utf8'
);

const requiredPrivacyFragments = [
  '最終改定日：2026年9月27日',
  'β版先行作者登録で入力するペンネーム',
  '読書進捗、最終閲覧日時、本棚の読書状態・リスト名・メモ',
  'Checkout Session ID',
  'Resend（先行利用案内・問い合わせ返信等のメール配信）',
  '一般的な広告・宣伝メールやニュースレターへの包括的な同意として取り扱いません',
  'カード番号そのものを保存する設計ではありません',
  '個人情報の開示・利用目的通知',
  '利用停止・消去・第三者提供停止',
  '退会・アカウント削除'
];

const requiredContactFragments = [
  '個人情報の開示・利用目的通知',
  '個人情報の訂正・追加・削除',
  '利用停止・消去・第三者提供停止',
  '退会・アカウント削除',
  '本人確認書類などの機密情報は入力・添付しないでください',
  '追加の本人確認が必要な場合'
];

test('privacy policy documents current data handling and processors', () => {
  for (const fragment of requiredPrivacyFragments) {
    assert.ok(privacy.includes(fragment));
  }
});

test('contact form exposes explicit privacy-rights request categories', () => {
  for (const fragment of requiredContactFragments) {
    assert.ok(contact.includes(fragment));
  }
});

test('beta preregistration consent stays scoped to beta participation communications', () => {
  assert.match(
    betaAuthors,
    /NOVELIGHT β版の公開・参加に関する連絡を受け取ることに同意します/
  );
  assert.doesNotMatch(betaAuthors, /広告・宣伝メール.*同意/);
  assert.doesNotMatch(betaAuthors, /ニュースレター.*同意/);
});
