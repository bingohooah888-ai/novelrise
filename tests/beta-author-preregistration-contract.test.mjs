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
const authReaderContext = read('auth-reader-context.js');
const publicApi = read('api/beta-author-preregistration.js');
const adminApi = read('api/admin-beta-authors.js');
const foundationMigration = read(
  'supabase/migrations/20260910210000_beta_author_preregistrations.sql'
);
const hardeningMigration = read(
  'supabase/migrations/20260910222500_beta_author_preregistration_hardening.sql'
);
const hardeningRollback = read(
  'supabase/rollback/20260910222500_beta_author_preregistration_hardening_rollback.sql'
);
const vercel = JSON.parse(read('vercel.json'));

test('beta author LP keeps required copy, fields and isolated navigation', () => {
  assert.match(betaHtml, /NOVELIGHT β版/);
  assert.match(betaHtml, /先行作者登録/);
  assert.match(betaHtml, /「良い物語なのに、読まれない」を変えたい。/);
  assert.match(betaHtml, /今すぐ先行登録する/);
  assert.match(betaHtml, /β版に先行登録する/);
  for (const id of [
    'penName',
    'email',
    'xAccount',
    'workUrl',
    'genre',
    'comment'
  ]) {
    assert.match(betaHtml, new RegExp(`id="${id}"`));
  }
  assert.match(
    betaHtml,
    /NOVELIGHT β版の公開・参加に関する連絡を受け取ることに同意します/
  );
  assert.doesNotMatch(betaHtml, /href="search\.html"/);
  assert.doesNotMatch(betaHtml, /href="ranking\.html"/);
  assert.doesNotMatch(betaHtml, /href="login\.html"/);
  assert.doesNotMatch(betaHtml, /href="mypage\.html"/);
  assert.doesNotMatch(betaHtml, /href="post\.html"/);
});

test('beta author LP is standalone and does not depend on shared theme or browser storage', () => {
  assert.match(betaHtml, /data-novelight-theme="standalone"/);
  assert.doesNotMatch(betaHtml, /src="novelight-client\.js"/);
  assert.doesNotMatch(betaHtml, /localStorage/);
  assert.doesNotMatch(betaHtml, /sessionStorage/);
  assert.doesNotMatch(betaHtml, /supabase\.createClient/);
  assert.match(betaHtml, /\/api\/beta-author-preregistration/);
});

test('beta author LP gets campaign state from server and fails closed', () => {
  assert.doesNotMatch(betaHtml, /const PAGE_STATE/);
  assert.match(betaHtml, /PRE_REGISTRATION/);
  assert.match(betaHtml, /BETA_OPEN/);
  assert.match(betaHtml, /CLOSED/);
  assert.match(betaHtml, /UNAVAILABLE/);
  assert.match(betaHtml, /安全のため、現在は先行登録を停止しています/);
  assert.match(betaHtml, /void loadCampaign\(\)/);
  assert.doesNotMatch(betaHtml, /2026年9月下旬/);
});

test('beta author LP records both page view and CTA while keeping counts private', () => {
  assert.match(betaHtml, /recordEvent\('page_view'\)/);
  assert.ok((betaHtml.match(/recordEvent\('cta_click'\)/g) ?? []).length >= 2);
  assert.doesNotMatch(betaHtml, /現在\s*\d+\s*名/);
  assert.doesNotMatch(betaHtml, /残り\s*\d+\s*名/);
  assert.doesNotMatch(betaHtml, /あと\s*\d+\s*枠/);
  assert.doesNotMatch(betaHtml, /\/api\/admin-beta-authors/);
});

test('public preregistration API owns the write boundary and avoids logging PII', () => {
  assert.match(publicApi, /createHmac/);
  assert.match(publicApi, /SUPABASE_SECRET_KEY/);
  assert.match(publicApi, /isSameOriginRequest/);
  assert.match(publicApi, /requestFingerprint/);
  assert.match(publicApi, /submit_beta_author_preregistration/);
  assert.match(publicApi, /record_beta_author_preregistration_event/);
  assert.match(publicApi, /Cache-Control/);
  assert.doesNotMatch(publicApi, /console\.log/);
});

test('hardening migration makes mutation RPCs server-only and campaign-state aware', () => {
  assert.match(hardeningMigration, /beta_author_preregistration_config/);
  assert.match(hardeningMigration, /PRE_REGISTRATION/);
  assert.match(hardeningMigration, /BETA_OPEN/);
  assert.match(hardeningMigration, /CLOSED/);
  assert.match(
    hardeningMigration,
    /revoke all on function public\.submit_beta_author_preregistration[\s\S]*from public, anon, authenticated;/
  );
  assert.match(
    hardeningMigration,
    /grant execute on function public\.submit_beta_author_preregistration[\s\S]*to service_role;/
  );
  assert.match(
    hardeningMigration,
    /revoke all on function public\.record_beta_author_preregistration_event[\s\S]*from public, anon, authenticated;/
  );
  assert.match(
    hardeningMigration,
    /grant execute on function public\.record_beta_author_preregistration_event[\s\S]*to service_role;/
  );
  assert.match(hardeningMigration, /pg_advisory_xact_lock/);
  assert.match(hardeningMigration, /interval '60 seconds'/);
  assert.match(hardeningMigration, /interval '5 seconds'/);
  assert.match(hardeningMigration, /v_hourly_count >= 120/);
});

test('raw preregistration and campaign data remain private', () => {
  assert.match(
    foundationMigration,
    /alter table public\.beta_author_preregistrations enable row level security;/
  );
  assert.match(
    foundationMigration,
    /revoke all on table public\.beta_author_preregistrations from public, anon, authenticated;/
  );
  assert.match(
    hardeningMigration,
    /alter table public\.beta_author_preregistration_config enable row level security;/
  );
  assert.match(
    hardeningMigration,
    /revoke all on table public\.beta_author_preregistration_config[\s\S]*from public, anon, authenticated;/
  );
  assert.doesNotMatch(hardeningMigration, /auth\.users/);
});

test('ADMIN API paginates and keeps milestone KPIs synchronized with statuses', () => {
  assert.match(adminApi, /requireAdmin/);
  assert.match(adminApi, /DEFAULT_PAGE_SIZE = 50/);
  assert.match(adminApi, /MAX_PAGE_SIZE = 100/);
  assert.match(adminApi, /\.range\(from, to\)/);
  assert.match(adminApi, /totalPages/);
  assert.match(adminApi, /applyMilestones/);
  assert.match(adminApi, /patch\.email_verified = true/);
  assert.match(
    adminApi,
    /patch\.invite_sent_at = current\.invite_sent_at \|\| now/
  );
  assert.match(
    adminApi,
    /patch\.registered_at = current\.registered_at \|\| now/
  );
  assert.match(
    adminApi,
    /patch\.first_novel_at = current\.first_novel_at \|\| now/
  );
  assert.match(adminApi, /beta_author_preregistration_config/);
  assert.doesNotMatch(adminApi, /'visitor_key'/);
  assert.doesNotMatch(adminApi, /'email_normalized'/);
});

test('ADMIN surface uses the safe Preview bootstrap and exposes campaign controls', () => {
  assert.match(adminHtml, /noindex,nofollow,noarchive/);
  assert.match(adminHtml, /data-novelight-theme="standalone"/);
  assert.match(adminHtml, /src="novelight-client\.js"/);
  assert.match(adminHtml, /id="campaignState"/);
  assert.match(adminHtml, /id="releaseLabel"/);
  assert.match(adminHtml, /id="saveCampaign"/);
  assert.match(adminHtml, /id="prevPage"/);
  assert.match(adminHtml, /id="nextPage"/);
  assert.match(adminHtml, /id="pageInfo"/);
  assert.match(adminHtml, /id="adminNote"/);
  assert.doesNotMatch(adminHtml, /SUPABASE_SECRET_KEY/);
});

test('ADMIN hub and login redirect include preregistration management', () => {
  assert.match(adminHubHtml, /href="admin-beta-authors\.html"/);
  assert.match(authReaderContext, /'\/admin-beta-authors\.html'/);
});

test('Vercel exposes clean preregistration routes and global security headers', () => {
  assert.deepEqual(vercel.rewrites, [
    { source: '/beta-authors', destination: '/beta-authors.html' },
    { source: '/admin/beta-authors', destination: '/admin-beta-authors.html' }
  ]);
  assert.ok(Array.isArray(vercel.headers));
  assert.ok(vercel.headers.length > 0);
});

test('hardening rollback restores original public RPC access and removes config', () => {
  assert.match(
    hardeningRollback,
    /drop table if exists public\.beta_author_preregistration_config/
  );
  assert.match(
    hardeningRollback,
    /grant execute on function public\.submit_beta_author_preregistration[\s\S]*to anon, authenticated;/
  );
  assert.match(
    hardeningRollback,
    /grant execute on function public\.record_beta_author_preregistration_event[\s\S]*to anon, authenticated;/
  );
});
