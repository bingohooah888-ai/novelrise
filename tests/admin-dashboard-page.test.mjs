import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const adminHtml = fs.readFileSync(
  new URL('../admin.html', import.meta.url),
  'utf8'
);
const authReaderContext = fs.readFileSync(
  new URL('../auth-reader-context.js', import.meta.url),
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

test('admin discovery watch exposes actionable delivery gaps without becoming a ranking input', () => {
  assert.match(adminHtml, /発見機会ウォッチ/);
  assert.match(adminHtml, /watchNoExposure/);
  assert.match(adminHtml, /watchNoRead/);
  assert.match(adminHtml, /ランキング・作品Rank・露出配分には反映しません/);
  assert.match(adminHtml, /露出起点の本文10秒閲覧/);
});

test('shared NOVELIGHT theme explicitly covers every admin page slug', () => {
  assert.match(themeCss, /data-novelight-page\^="admin-"/);
  assert.match(themeCss, /novelight-page-admin/);
  assert.match(themeCss, /#f7f2e7/i);
  assert.match(themeCss, /#eac46a/i);
});

test('admin specialized readability overrides remain covered', () => {
  assert.match(readabilityCss, /novelight-page-admin-thumbnails/);
  assert.match(readabilityCss, /novelight-page-admin-scout/);
  assert.match(readabilityCss, /\.quad-field strong/);
  assert.match(readabilityCss, /\.quad-controls > label > span/);
  assert.match(readabilityCss, /\.quad-meta/);
  assert.match(readabilityCss, /\.validation/);
  assert.match(readabilityCss, /\.row strong/);
  assert.match(readabilityCss, /\.brand > span/);
  assert.match(readabilityCss, /font-size:\s*15px !important/);
  assert.match(readabilityCss, /font-size:\s*14px !important/);
  assert.match(readabilityCss, /#f3d98e/i);
});

test('admin compact operational rows stay readable without inheriting oversized KPI numerals', () => {
  assert.match(
    themeCss,
    /\.work \.num\s*\{[\s\S]*?font-size:\s*15px !important;/
  );
  assert.match(
    themeCss,
    /\.row strong\s*\{[\s\S]*?font-size:\s*15px !important;/
  );
  assert.match(
    themeCss,
    /\.brand > span\s*\{[\s\S]*?padding:\s*4px 9px;[\s\S]*?font-size:\s*13px !important;/
  );
});

test('login redirect allowlist explicitly permits the private admin page', () => {
  assert.match(authReaderContext, /'\/admin\.html'/);
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

test('admin dashboard surfaces beta KPI gaps from the MASTER without using stale favorite counters', () => {
  assert.match(adminHtml, /作者7日継続率/);
  assert.match(adminHtml, /読者7日継続率/);
  assert.match(adminHtml, /登録→初作品作成率/);
  assert.match(adminHtml, /1読者あたり閲覧作品数/);
  assert.match(adminHtml, /期間内の露出（露出時プラン）/);
  assert.match(adminHtml, /favorites正本 \/ 自己お気に入り除外/);
});
