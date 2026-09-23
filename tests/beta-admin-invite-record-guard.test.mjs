import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const adminHtml = read('admin-beta-authors.html');
const adminApi = read('api/admin-beta-authors.js');
const inviteApi = read('api/admin-beta-author-invites.js');

test('beta admin uses a real secure email invite action', () => {
  assert.match(adminHtml, /先行利用メール/);
  assert.match(adminHtml, /未送信者へ招待メールを送る/);
  assert.match(adminHtml, /本人専用/);
  assert.match(adminHtml, /実メール送信です/);
  assert.match(inviteApi, /https:\/\/api\.resend\.com\/emails/);
  assert.match(inviteApi, /NOVELIGHT <noreply@novelight\.jp>/);
  assert.match(inviteApi, /Idempotency-Key/);
});

test('email verification and invite milestones are system-owned', () => {
  assert.match(adminApi, /SYSTEM_OWNED_STATUSES/);
  assert.match(adminApi, /'verified', 'invited'/);
  assert.doesNotMatch(
    adminApi,
    /patch\.email_verified\s*=\s*true/
  );
  assert.doesNotMatch(
    adminApi,
    /patch\.invite_sent_at\s*=\s*current\.invite_sent_at\s*\|\|\s*now/
  );
  assert.match(
    adminHtml,
    /option\.value==='verified'\|\|option\.value==='invited'/
  );
});

test('invite sender never exposes raw token through admin status responses', () => {
  assert.match(inviteApi, /createHmac/);
  assert.match(inviteApi, /createHash/);
  assert.match(inviteApi, /token_hash/);
  assert.doesNotMatch(inviteApi, /token:\s*token/);
  assert.doesNotMatch(inviteApi, /console\.log/);
});
