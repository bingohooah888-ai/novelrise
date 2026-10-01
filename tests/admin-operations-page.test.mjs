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
const authReaderContext = read('auth-reader-context.js');
const indexHtml = read('index.html');

const privatePages = [adminHtml, announcementsHtml, inquiriesHtml, reportsHtml];

test('ADMIN HOME links to operational queues without embedding long lists', () => {
  assert.match(adminHtml, /href="admin-inquiries\.html"/);
  assert.match(adminHtml, /href="admin-reports\.html"/);
  assert.match(adminHtml, /href="admin-announcements\.html"/);
  assert.doesNotMatch(adminHtml, /id="inquiryList"/);
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
  assert.match(inquiriesHtml, /\/api\/admin-inquiry-reply/);
  assert.match(reportsHtml, /\/api\/admin-reports/);
});

test('inquiries use server-side pagination with requested filters', () => {
  assert.match(inquiriesHtml, /20件\/ページ/);
  assert.match(inquiriesHtml, /50件\/ページ/);
  assert.match(inquiriesHtml, /pageSize/);
  assert.match(inquiriesHtml, /filterStatus/);
  assert.match(inquiriesHtml, /filterUser/);
  assert.match(inquiriesHtml, /filterCategory/);
  assert.match(inquiriesHtml, /filterFrom/);
  assert.match(inquiriesHtml, /filterTo/);
  assert.match(inquiriesHtml, /prevPage/);
  assert.match(inquiriesHtml, /nextPage/);
});

test('inquiry detail keeps reply and status-change workflows', () => {
  assert.match(inquiriesHtml, /この問い合わせに返信/);
  assert.match(inquiriesHtml, /返信して完了にする/);
  assert.match(inquiriesHtml, /実メールを1通送信/);
  assert.match(inquiriesHtml, /\/api\/admin-inquiry-reply/);
  assert.match(inquiriesHtml, /ステータス変更/);
});

test('contact page combines published announcements with the safe inquiry RPC', () => {
  assert.match(contactHtml, /お知らせ・お問い合わせ/);
  assert.match(contactHtml, /\/api\/announcements/);
  assert.match(contactHtml, /submit_contact_inquiry/);
  assert.match(contactHtml, /contactWebsite/);
  assert.match(contactHtml, /p_visitor_token/);
  assert.match(contactHtml, /短時間に送信できる回数/);
});

test('home footer routes support traffic to the contact page', () => {
  assert.match(indexHtml, /href="contact\.html">お知らせ・お問い合わせ<\/a>/);
});

test('login redirect allowlist covers private ADMIN operations pages', () => {
  assert.match(authReaderContext, /'\/admin\.html'/);
  assert.match(authReaderContext, /'\/admin-announcements\.html'/);
  assert.match(authReaderContext, /'\/admin-inquiries\.html'/);
  assert.match(authReaderContext, /'\/admin-reports\.html'/);
});

test('inquiry list obtains details separately from the paged summary', () => {
  assert.match(inquiriesHtml, /\/api\/admin-inquiries\?id=/);
  assert.match(inquiriesHtml, /詳細情報は認証済み＋管理者allowlist確認済み/);
});
