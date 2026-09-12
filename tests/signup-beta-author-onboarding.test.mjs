import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const signup = await readFile('signup.html', 'utf8');

test('signup explains the beta Standard path before account creation', () => {
  assert.match(signup, /β期間中はStandardを無料・カード登録不要で利用できます/u);
  assert.match(signup, /会員登録後、料金プランから有効化してください/u);
});

test(
  'signup confirmation tells authors where to continue after email verification',
  () => {
    assert.match(signup, /確認後は「創作室」から投稿を始められます/u);
    assert.match(signup, /Standard無料利用は料金プランから有効化できます/u);
    assert.match(signup, /カード登録不要/u);
  }
);

test(
  'signup onboarding copy does not change the existing auth or billing contract',
  () => {
    assert.match(
      signup,
      /emailRedirectTo:window\.location\.origin\+'\/index\.html'/u
    );
    assert.doesNotMatch(signup, /\/api\/activate-beta-standard/u);
    assert.doesNotMatch(signup, /novelight_activate_beta_standard/u);
  }
);
