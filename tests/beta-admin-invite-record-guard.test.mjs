import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const adminHtml = read('admin-beta-authors.html');
const adminApi = read('api/admin-beta-authors.js');

test('beta admin presents invited as a manual outreach record, not a send action', () => {
  assert.match(adminHtml, /案内送付記録済み/);
  assert.match(adminHtml, /案内送付記録済み（手動）/);
  assert.match(adminHtml, /この画面からメールやDMは送信されません/);
  assert.match(adminHtml, /案内送付記録/);
  assert.doesNotMatch(adminHtml, /招待送信済み/);
  assert.doesNotMatch(adminHtml, />招待済み</);
});

test('beta admin confirms before first marking outreach as sent', () => {
  assert.match(
    adminHtml,
    /function confirmInviteRecordStatusChange\(nextStatus\)/
  );
  assert.match(
    adminHtml,
    /if\(!selected\|\|nextStatus!==['"]invited['"]\|\|selected\.status===['"]invited['"]\)return true;/
  );
  assert.match(adminHtml, /送付済みとして記録しますか/);
  assert.match(
    adminHtml,
    /if\(!confirmInviteRecordStatusChange\(nextStatus\)\)/
  );
});

test('beta invite milestone remains record-only and does not add an outbound mail path', () => {
  assert.match(
    adminApi,
    /patch\.invite_sent_at = current\.invite_sent_at \|\| now/
  );
  assert.doesNotMatch(adminApi, /inviteUserByEmail/);
  assert.doesNotMatch(adminApi, /auth\.admin/);
  assert.doesNotMatch(adminApi, /sendEmail/);
  assert.doesNotMatch(adminApi, /nodemailer/i);
  assert.doesNotMatch(adminApi, /sendgrid/i);
  assert.doesNotMatch(adminApi, /resend/i);
});
