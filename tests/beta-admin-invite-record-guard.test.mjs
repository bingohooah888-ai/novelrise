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

test('beta admin makes invite verification and delivery system-owned', () => {
  assert.match(adminHtml, /招待メール送信済み/);
  assert.match(adminHtml, /メール確認済み（自動）/);
  assert.match(adminHtml, /招待メール送信済み（自動）/);
  assert.match(
    adminHtml,
    /systemOwned=option\.value==='verified'\|\|option\.value==='invited'/
  );
  assert.doesNotMatch(adminHtml, /案内送付記録済み（手動）/);
  assert.doesNotMatch(adminHtml, /confirmInviteRecordStatusChange/);

  assert.match(
    adminApi,
    /SYSTEM_OWNED_STATUSES = new Set\(\['verified', 'invited'\]\)/
  );
  assert.match(adminApi, /SYSTEM_OWNED_STATUSES\.has\(status\)/);
  assert.doesNotMatch(adminApi, /patch\.email_verified\s*=\s*true/);
  assert.doesNotMatch(adminApi, /patch\.invite_sent_at\s*=/);
});

test('beta admin exposes an explicit real-mail action only for AUTHOR_PREOPEN', () => {
  assert.match(adminHtml, /id="sendInvites"/);
  assert.match(adminHtml, /実メール送信です。実行しますか/);
  assert.match(adminHtml, /\/api\/admin-beta-author-invites/);
  assert.match(inviteApi, /requireAdmin/);
  assert.match(inviteApi, /state !== 'AUTHOR_PREOPEN'/);
  assert.match(inviteApi, /RESEND_API_KEY/);
  assert.match(inviteApi, /https:\/\/api\.resend\.com\/emails/);
  assert.match(inviteApi, /NOVELIGHT <noreply@novelight\.jp>/);
});

test('outbound invites are idempotent and do not persist raw bearer tokens', () => {
  assert.match(inviteApi, /createHmac\('sha256'/);
  assert.match(inviteApi, /createHash\('sha256'/);
  assert.match(inviteApi, /Idempotency-Key/);
  assert.match(inviteApi, /novelight-beta-author-invite-/);
  assert.match(inviteApi, /token_hash: tokenHash/);
  assert.doesNotMatch(inviteApi, /raw_token/);
  assert.match(inviteApi, /url\.hash = `invite=/);
  assert.match(inviteApi, /if \(invite\.sent_at\)/);
});
