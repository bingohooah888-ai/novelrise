import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const adminHtml = read('admin.html');
const adminApi = read('api/admin-dashboard-v2.js');
const analyticsHtml = read('admin-analytics.html');
const authReaderContext = read('auth-reader-context.js');
const themeCss = read('novelight-theme.css');
const readabilityCss = read('novelight-readability.css');

test('admin HOME is private and uses the lightweight dashboard endpoint', () => {
  assert.match(adminHtml, /noindex,nofollow,noarchive/);
  assert.match(adminHtml, /\/api\/admin-dashboard-v2/);
  assert.doesNotMatch(adminHtml, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(adminHtml, /NOVELIGHT_ADMIN_USER_IDS/);
  assert.doesNotMatch(adminHtml, /NOVELIGHT_ADMIN_EMAILS/);
  assert.match(adminApi, /requireAdmin/);
  assert.match(adminApi, /process\.env\.SUPABASE_SECRET_KEY/);
});

test('admin HOME focuses on the ten today KPIs and decision signals', () => {
  for (const label of [
    '今日のユニーク来訪者',
    '今日のアクティブユーザー',
    '今日の新規登録者',
    '新規作者数',
    '新規読者数',
    '今日投稿された作品数',
    '今日公開された話数',
    '今日実際に読んだ人数',
    '未対応お問い合わせ',
    '重大エラー / 異常検知'
  ]) {
    assert.match(adminHtml, new RegExp(label));
  }
  assert.match(adminHtml, /来訪者 → 実読書/);
  assert.match(adminHtml, /PVゼロ作品率/);
  assert.match(adminApi, /query\.in\('status', \['new', 'reviewing'\]\)/);
});

test('daily chart supports 7, 30, 90 and all-time views with metric toggles', () => {
  assert.match(adminHtml, /data-range="7"/);
  assert.match(adminHtml, /data-range="30"/);
  assert.match(adminHtml, /data-range="90"/);
  assert.match(adminHtml, /data-range="all"/);
  assert.match(adminHtml, /data-key="unique_visitors"/);
  assert.match(adminHtml, /data-key="pageviews"/);
  assert.match(adminHtml, /data-key="logged_in_users"/);
  assert.match(adminHtml, /data-key="reading_users"/);
});

test('HOME reads aggregated daily metrics instead of loading raw analytics tables', () => {
  assert.match(adminApi, /admin_metrics_daily/);
  assert.match(adminApi, /novelight_admin_refresh_metrics_daily/);
  assert.doesNotMatch(adminApi, /\.from\('reader_journey_events'\)/);
  assert.doesNotMatch(adminApi, /\.from\('user_lifecycle'\)/);
  assert.doesNotMatch(adminApi, /\.from\('user_acquisition'\)/);
});

test('HOME states measurement limits instead of presenting inferred history as fact', () => {
  assert.match(adminHtml, /エピソード閲覧PV/);
  assert.match(adminApi, /episodeFirstPublishedAt: 'migration-activation'/);
  assert.match(adminApi, /過去の公開日時は推測しません/);
});

test('detailed analytics remain separate from HOME', () => {
  assert.match(adminHtml, /href="admin-analytics\.html"/);
  assert.match(analyticsHtml, /利用状況/);
  assert.match(analyticsHtml, /読者ファネル/);
  assert.match(analyticsHtml, /作者ファネル/);
  assert.match(analyticsHtml, /リテンション \/ コホート/);
  assert.match(analyticsHtml, /作品発見・露出/);
  assert.match(analyticsHtml, /流入元/);
});

test('shared NOVELIGHT theme still covers admin pages', () => {
  assert.match(themeCss, /data-novelight-page\^="admin-"/);
  assert.match(themeCss, /novelight-page-admin/);
  assert.match(readabilityCss, /novelight-page-admin-thumbnails/);
  assert.match(readabilityCss, /novelight-page-admin-scout/);
});

test('login redirect allowlist permits the private admin page', () => {
  assert.match(authReaderContext, /'\/admin\.html'/);
});
