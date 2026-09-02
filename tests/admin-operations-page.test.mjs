import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const adminHtml = read('admin.html');
const announcementsHtml = read('admin-announcements.html');
const inquiriesHtml = read('admin-inquiries.html');
const reportsHtml = read('admin-reports.html');
const contactHtml = read('contact.html');
const loginHtml = read('login.html');
const indexHtml = read('index.html');

const privatePages = [adminHtml, announcementsHtml, inquiriesHtml, reportsHtml];

test('ADMIN top is an operations hub with links to all three operator queues', () => {
  assert.match(adminHtml, /id="pendingInquiries"/);
  assert.match(adminHtml, /id="pendingReports"/);
  assert.match(adminHtml, /id="publishedAnnouncements"/);
  assert.match(adminHtml, /href="admin-inquiries\.html"/);
  assert.match(adminHtml, /href="admin-reports\.html"/);
  assert.match(adminHtml, /href="admin-announcements\.html"/);
  assert.match(adminHtml, /\/api\/admin-operations-summary/);
});

test('ADMIN operation pages remain private surfaces backed by server endpoints', () => {
  for (const html of privatePages) {
    assert.match(html, /noindex,nofollow,noarchive/);
    assert.doesNotMatch(html, /SUPABASE_SECRET_KEY/);
    assert.doesNotMatch(html, /NOVELIGHT_ADMIN_USER_IDS/);
    assert.doesNotMatch(html, /NOVELIGHT_ADMIN_EMAILS/);
  }

  assert.match(announcementsHtml, /\/api\/admin-announcements/);
  assert.match(inquiriesHtml, /\/api\/admin-inquiries/);
  assert.match(reportsHtml, /\/api\/admin-reports/);
});

test('contact page combines published announcements with the existing safe inquiry RPC', () => {
  assert.match(contactHtml, /お知らせ・お問い合わせ/);
  assert.match(contactHtml, /\/api\/announcements/);
  assert.match(contactHtml, /submit_contact_inquiry/);
  assert.match(contactHtml, /contactWebsite/);
  assert.match(contactHtml, /p_visitor_token/);
  assert.match(contactHtml, /短時間に送信できる回数/);
});

test('home footer routes support traffic to the combined announcements and contact page', () => {
  assert.match(indexHtml, /href="contact\.html">お知らせ・お問い合わせ<\/a>/);
});

test('login redirect allowlist covers every private ADMIN operations page', () => {
  assert.match(loginHtml, /'\/admin\.html'/);
  assert.match(loginHtml, /'\/admin-announcements\.html'/);
  assert.match(loginHtml, /'\/admin-inquiries\.html'/);
  assert.match(loginHtml, /'\/admin-reports\.html'/);
});

test('inquiry and report list pages state that sensitive raw fields are excluded', () => {
  assert.match(inquiriesHtml, /一覧には必要最小限の情報だけを表示/);
  assert.match(reportsHtml, /通報本文や通報者情報はこの一覧APIへ含めません/);
});
