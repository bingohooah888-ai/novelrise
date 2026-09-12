import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const adminHtml = fs.readFileSync(
  new URL('../admin.html', import.meta.url),
  'utf8'
);
const loginHtml = fs.readFileSync(
  new URL('../login.html', import.meta.url),
  'utf8'
);
const adminApi = fs.readFileSync(
  new URL('../api/admin-dashboard.js', import.meta.url),
  'utf8'
);
const themeCss = fs.readFileSync(
  new URL('../novelight-theme.css', import.meta.url),
  'utf8'
);
const readabilityCss = fs.readFileSync(
  new URL('../novelight-readability.css', import.meta.url),
  'utf8'
);

test('admin page is noindex and has no server secret embedded in browser code', () => {
  assert.match(adminHtml, /noindex,nofollow,noarchive/);
  assert.match(adminHtml, /\/api\/admin-dashboard/);
  assert.doesNotMatch(adminHtml, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(adminHtml, /NOVELIGHT_ADMIN_USER_IDS/);
  assert.doesNotMatch(adminHtml, /NOVELIGHT_ADMIN_EMAILS/);
});

test('admin API obtains the Supabase secret only from the server environment', () => {
  assert.match(adminApi, /process\.env\.SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(adminApi, /sb_secret_/);
  assert.doesNotMatch(adminApi, /service_role/);
});

test('admin active cards show registered users and use a non-destructive reset epoch', () => {
  assert.match(adminHtml, /7日アクティブ登録ユーザー/);
  assert.match(adminHtml, /30日アクティブ登録ユーザー/);
  assert.match(adminHtml, /activeRegisteredUsers7d/);
  assert.match(adminHtml, /activeRegisteredUsers30d/);
  assert.match(adminApi, /user_lifecycle/);
  assert.match(adminApi, /NOVELIGHT_ADMIN_ACTIVITY_RESET_AT/);
  assert.match(adminApi, /ACTIVE_REGISTERED_RESET_FALLBACK/);
});

test('shared NOVELIGHT theme explicitly covers every admin page slug', () => {
  assert.match(themeCss, /data-novelight-page\^="admin-"/);
  assert.match(themeCss, /novelight-page-admin/);
  assert.match(themeCss, /#f7f2e7/i);
  assert.match(themeCss, /#eac46a/i);
});

test('shared admin readability layer covers specialized residual small text', () => {
  assert.match(readabilityCss, /novelight-page-admin-thumbnails \.quad-field strong/);
  assert.match(readabilityCss, /:is\(\.quad-meta, \.validation\)/);
  assert.match(readabilityCss, /novelight-page-admin-scout \.row strong/);
  assert.match(readabilityCss, /novelight-page-admin-thumbnails \.brand > span/);
  assert.match(readabilityCss, /font-size:\s*15px !important/);
  assert.match(readabilityCss, /font-size:\s*14px !important/);
  assert.match(readabilityCss, /#f3d98e/i);
});

test('login redirect allowlist explicitly permits the private admin page', () => {
  assert.match(loginHtml, /'\/admin\.html'/);
});

test('admin page does not add itself to ordinary site navigation', () => {
  const ordinaryPages = ['index.html', 'mypage.html', 'pricing.html'];
  for (const page of ordinaryPages) {
    if (!fs.existsSync(new URL(`../${page}`, import.meta.url))) continue;
    const content = fs.readFileSync(
      new URL(`../${page}`, import.meta.url),
      'utf8'
    );
    assert.doesNotMatch(content, /href=["']admin\.html["']/);
  }
});
