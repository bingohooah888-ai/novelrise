import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const betaHtml = read('beta-authors.html');
const adminHtml = read('admin-beta-authors.html');
const adminHubHtml = read('admin.html');
const loginHtml = read('login.html');
const adminApi = read('api/admin-beta-authors.js');
const migration = read(
  'supabase/migrations/20260910210000_beta_author_preregistrations.sql'
);
const rollback = read(
  'supabase/rollback/20260910210000_beta_author_preregistrations_rollback.sql'
);
const vercel = JSON.parse(read('vercel.json'));

test('beta author LP contains the required preregistration message and form', () => {
  assert.match(betaHtml, /NOVELIGHT β版/);
  assert.match(betaHtml, /先行作者登録/);
  assert.match(betaHtml, /「良い作品なのに、読まれない」を変えたい。/);
  assert.match(betaHtml, /2026年9月下旬/);
  assert.match(betaHtml, /β版に先行登録する/);
  assert.match(betaHtml, /id="penName"/);
  assert.match(betaHtml, /id="email"/);
  assert.match(betaHtml, /id="xAccount"/);
  assert.match(betaHtml, /id="workUrl"/);
  assert.match(betaHtml, /id="genre"/);
  assert.match(betaHtml, /id="comment"/);
  assert.match(
    betaHtml,
    /NOVELIGHT β版の公開・参加に関する連絡を受け取ることに同意します/
  );
  assert.match(betaHtml, /submit_beta_author_preregistration/);
  assert.match(betaHtml, /record_beta_author_preregistration_event/);
  assert.match(betaHtml, /page_view/);
  assert.match(betaHtml, /cta_click/);
});

test('beta author LP does not expose preregistration counts or normal product navigation', () => {
  assert.doesNotMatch(betaHtml, /現在\s*\d+\s*名/);
  assert.doesNotMatch(betaHtml, /残り\s*\d+\s*名/);
  assert.doesNotMatch(betaHtml, /あと\s*\d+\s*枠/);
  assert.doesNotMatch(betaHtml, /\/api\/admin-beta-authors/);
  assert.doesNotMatch(betaHtml, /href="search\.html"/);
  assert.doesNotMatch(betaHtml, /href="ranking\.html"/);
  assert.doesNotMatch(betaHtml, /href="login\.html"/);
  assert.doesNotMatch(betaHtml, /href="mypage\.html"/);
  assert.doesNotMatch(betaHtml, /href="post\.html"/);
});

test('preregistration schema keeps raw data private and public access append-only through RPCs', () => {
  assert.match(
    migration,
    /alter table public\.beta_author_preregistrations enable row level security;/
  );
  assert.match(
    migration,
    /revoke all on table public\.beta_author_preregistrations from public, anon, authenticated;/
  );
  assert.match(migration, /email_normalized text not null/);
  assert.match(
    migration,
    /constraint beta_author_preregistrations_email_normalized_unique unique \(email_normalized\)/
  );
  assert.match(
    migration,
    /grant execute on function public\.submit_beta_author_preregistration[\s\S]*to anon, authenticated;/
  );
  assert.match(
    migration,
    /grant execute on function public\.record_beta_author_preregistration_event[\s\S]*to anon, authenticated;/
  );
  assert.doesNotMatch(migration, /grant\s+select[\s\S]*to\s+(?:anon|authenticated)/i);
  assert.doesNotMatch(migration, /get_beta_author.*count/i);
});

test('public preregistration does not create a Supabase Auth user', () => {
  assert.doesNotMatch(migration, /auth\.users/);
  assert.doesNotMatch(betaHtml, /signUp\s*\(/);
  assert.doesNotMatch(betaHtml, /createUser\s*\(/);
});

test('ADMIN preregistration surface is private and includes required operations KPIs', () => {
  assert.match(adminHtml, /noindex,nofollow,noarchive/);
  assert.match(adminHtml, /\/api\/admin-beta-authors/);
  assert.match(adminHtml, /id="metricTotal"/);
  assert.match(adminHtml, /id="metricToday"/);
  assert.match(adminHtml, /id="metricVerified"/);
  assert.match(adminHtml, /id="metricInvited"/);
  assert.match(adminHtml, /id="metricRegistered"/);
  assert.match(adminHtml, /id="metricFirstNovel"/);
  assert.match(adminHtml, /id="adminNote"/);
  assert.match(adminHtml, /ペンネーム・メール検索/);
  assert.match(adminHtml, /id="statusFilter"/);
  assert.doesNotMatch(adminHtml, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(adminHtml, /NOVELIGHT_ADMIN_USER_IDS/);
  assert.doesNotMatch(adminHtml, /NOVELIGHT_ADMIN_EMAILS/);
});

test('ADMIN API is protected by the existing allowlist gate and does not return internal dedupe keys', () => {
  assert.match(adminApi, /requireAdmin/);
  assert.match(adminApi, /SUPABASE_SECRET_KEY/);
  assert.match(adminApi, /beta_author_preregistrations/);
  assert.match(adminApi, /beta_author_preregistration_events/);
  assert.doesNotMatch(adminApi, /'visitor_key'/);
  assert.doesNotMatch(adminApi, /'email_normalized'/);
});

test('ADMIN hub and login redirect allowlist include the beta preregistration screen', () => {
  assert.match(adminHubHtml, /href="admin-beta-authors\.html"/);
  assert.match(loginHtml, /'\/admin-beta-authors\.html'/);
});

test('Vercel exposes clean preregistration URLs without changing other security headers', () => {
  assert.deepEqual(vercel.rewrites, [
    { source: '/beta-authors', destination: '/beta-authors.html' },
    { source: '/admin/beta-authors', destination: '/admin-beta-authors.html' }
  ]);
  assert.ok(Array.isArray(vercel.headers));
  assert.ok(vercel.headers.length > 0);
});

test('rollback removes the preregistration functions and private tables', () => {
  assert.match(
    rollback,
    /drop function if exists public\.submit_beta_author_preregistration/
  );
  assert.match(
    rollback,
    /drop function if exists public\.record_beta_author_preregistration_event/
  );
  assert.match(
    rollback,
    /drop table if exists public\.beta_author_preregistration_events;/
  );
  assert.match(
    rollback,
    /drop table if exists public\.beta_author_preregistrations;/
  );
});