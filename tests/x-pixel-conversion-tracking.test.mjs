import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const client = fs.readFileSync('novelight-client.js', 'utf8');
const signup = fs.readFileSync('signup.html', 'utf8');
const privacy = fs.readFileSync('privacy.html', 'utf8');
const campaign = fs.readFileSync('scout-lv10-campaign.html', 'utf8');

test('X Pixel config defaults to off', () => {
  assert.ok(client.includes("pixelId: ''"));
  assert.ok(client.includes("signupEventId: ''"));
  assert.ok(client.includes("'novelight.jp'"));
  assert.ok(client.includes("'www.novelight.jp'"));
  assert.ok(client.includes('https://static.ads-twitter.com/uwt.js'));
  assert.ok(client.includes("window.twq('config', config.pixelId)"));
  assert.ok(client.includes("window.twq('event', config.signupEventId)"));
});

test('signup conversion is accepted-only and deduplicated', () => {
  const signupCall = signup.indexOf('client.auth.signUp');
  const conversionCall = signup.indexOf(
    'NovelightClient.trackXSignupConversion(data?.user?.id)'
  );
  assert.ok(signupCall >= 0);
  assert.ok(conversionCall > signupCall);
  assert.ok(client.includes('novelight_x_signup_conversion:'));
  assert.ok(client.includes('window.localStorage.getItem(dedupeKey)'));
  assert.ok(client.includes('trackXSignupConversion,'));
});

test('campaign page loads shared tracking runtime', () => {
  assert.ok(campaign.includes('src="novelight-client.js"'));
});

test('privacy policy discloses X measurement', () => {
  assert.ok(privacy.includes('X Pixel'));
  assert.ok(privacy.includes('広告の効果測定・配信最適化'));
  assert.ok(privacy.includes('X（広告配信・効果測定）'));
  assert.ok(privacy.includes('コンバージョンイベントパラメータとして送信しません'));
});
