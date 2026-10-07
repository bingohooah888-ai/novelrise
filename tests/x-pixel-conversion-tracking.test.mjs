import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const client = fs.readFileSync('novelight-client.js', 'utf8');
const signup = fs.readFileSync('signup.html', 'utf8');
const privacy = fs.readFileSync('privacy.html', 'utf8');
const campaign = fs.readFileSync('scout-lv10-campaign.html', 'utf8');

test('X Pixel is fail closed', () => {
  assert.match(client, /pixelId:\s*''/);
  assert.match(client, /signupEventId:\s*''/);
  assert.match(client, /X_PIXEL_PRODUCTION_HOSTS/);
  assert.match(client, /static\.ads-twitter\.com/);
  assert.match(client, /twq\('config'/);
  assert.match(client, /twq\('event'/);
});

test('signup fires one conversion per user', () => {
  const signupCall = signup.indexOf('client.auth.signUp');
  const eventCall = signup.indexOf('recordXSignupConversion(data?.user?.id)');
  assert.ok(signupCall >= 0);
  assert.ok(eventCall > signupCall);
  assert.match(client, /novelight_x_signup_conversion:/);
  assert.match(client, /localStorage\.getItem\(dedupeKey\)/);
});

test('campaign loads shared tracking', () => {
  assert.match(campaign, /novelight-client\.js/);
});

test('privacy discloses X measurement', () => {
  assert.match(privacy, /X Pixel/);
  assert.match(privacy, /広告の効果測定・配信最適化/);
  assert.match(privacy, /X（広告配信・効果測定）/);
  assert.match(privacy, /コンバージョンイベントパラメータ/);
});
