import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

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
