import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const client = fs.readFileSync('novelight-client.js', 'utf8');
const signup = fs.readFileSync('signup.html', 'utf8');
const privacy = fs.readFileSync('privacy.html', 'utf8');
const campaign = fs.readFileSync('scout-lv10-campaign.html', 'utf8');

test('X Pixel stays disabled until configured', () => {
  assert.match(client, /pixelId:\s*''/);
  assert.match(client, /signupEventId:\s*''/);
  assert.match(
    client,
    /X_PIXEL_PRODUCTION_HOSTS = new Set\(\[\s*'novelight\.jp',\s*'www\.novelight\.jp'\s*\]\)/
  );
  assert.match(client, /https:\/\/static\.ads-twitter\.com\/uwt\.js/);
  assert.match(client, /window\.twq\('config', config\.pixelId\)/);
  assert.match(client, /window\.twq\('event', config\.signupEventId\)/);
});

test('signup conversion is accepted-only and deduplicated', () => {
  const accepted = signup.indexOf(
    'NovelightClient.trackXSignupConversion(data?.user?.id)'
  );
  const signupCall = signup.indexOf('client.auth.signUp');
  assert.ok(signupCall >= 0);
  assert.ok(accepted > signupCall);
  assert.match(client, /novelight_x_signup_conversion:/);
  assert.match(
    client,
    /window\.localStorage\.getItem\(dedupeKey\) === '1'/
  );
  assert.match(client, /trackXSignupConversion,/);
});

test('campaign page loads shared tracking runtime', () => {
  assert.match(campaign, /src="novelight-client\.js"/);
});

test('privacy policy discloses X measurement', () => {
  assert.match(privacy, /X Pixel/);
  assert.match(privacy, /広告の効果測定・配信最適化/);
  assert.match(privacy, /X（広告配信・効果測定）/);
  assert.match(
    privacy,
    /メールアドレス、表示名、パスワード、カード情報またはNOVELIGHTのユーザーIDをXのコンバージョンイベントパラメータとして送信しません/
  );
});
