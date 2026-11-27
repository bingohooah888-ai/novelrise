import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const nav = await readFile('novelight-work-navigation.js', 'utf8');
const insights = await readFile('novelight-analytics-insights.js', 'utf8');
const reports = await readFile('admin-reports.html', 'utf8');
const inquiries = await readFile('admin-inquiries.html', 'utf8');
const search = await readFile('search.html', 'utf8');
const analytics = await readFile('novelight-analytics.js', 'utf8');
const browser = { window: {} };
vm.runInNewContext(nav, browser);
vm.runInNewContext(insights, browser);

test('reader filters only the returned episode characters', () => {
  const filter = browser.window.NovelightWorkNavigation.filterEpisodeCharacters;
  const rows = [
    { name: 'ＡＢＣ', appears_current_episode: true },
    { name: 'abc', appears_current_episode: false },
    { name: '別の人物', appears_current_episode: true }
  ];
  const before = JSON.stringify(rows);
  assert.equal(filter(rows, 'abc').length, 2);
  assert.equal(filter(rows, 'abc', true).length, 1);
  assert.equal(filter(rows, '', true).length, 2);
  assert.equal(filter(rows, 'x'.repeat(81)).length, 0);
  assert.equal(JSON.stringify(rows), before);
  assert.match(nav, /makeEpisodeCharacterTools\(characters\)/u);
});

test('reports group and filter only safe received metadata', () => {
  const start = reports.indexOf('  function reportCounts(');
  const end = reports.indexOf('  function renderReports(', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(reports.slice(start, end), context);
  const rows = [
    { category: 'a', status: 'new', created_at: '2026-11-20' },
    { category: 'a', status: 'reviewing', created_at: '2026-11-19' },
    { category: 'b', status: 'new', created_at: '2026-11-18' }
  ];
  const before = JSON.stringify(rows);
  const counts = context.reportCounts(rows);
  assert.equal(JSON.stringify(counts), '[["a",2],["b",1]]');
  assert.equal(context.selectReports(rows, 'a', 'new', false).length, 1);
  assert.equal(context.selectReports(rows, '', '', true)[0], rows[2]);
  assert.equal(JSON.stringify(rows), before);
  assert.match(reports, /取得範囲のカテゴリ別件数/u);
});

test('inquiry support uses fixed text and current page counts', () => {
  const start = inquiries.indexOf('  const inquiryTemplates=');
  const end = inquiries.indexOf('  function replyEditor(', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(inquiries.slice(start, end), context);
  assert.match(context.inquiryTemplate('detail'), /機密情報/u);
  assert.equal(context.inquiryTemplate('constructor'), '');
  const counts = context.inquiryPageCounts([
    { status: 'new' },
    { status: 'reviewing' },
    { status: 'resolved' },
    { status: 'unknown' }
  ]);
  assert.deepEqual(
    { ...counts },
    {
      new: 1,
      reviewing: 1,
      resolved: 1,
      other: 1
    }
  );
  assert.match(inquiries, /preview\.readOnly=true/u);
  assert.match(inquiries, /このページのみ/u);
});

test('author work tools filter and sort without changing source rows', () => {
  const select = browser.window.NovelightAnalyticsInsights.selectWorkRows;
  const rows = [
    { title: 'ＡＢＣ', impressions: '10' },
    { title: '別作品', impressions: 30 },
    { title: 'abc', impressions: null }
  ];
  const before = JSON.stringify(rows);
  assert.equal(select(rows, 'abc').length, 2);
  const sorted = select(rows, '', 'impressions');
  assert.equal(sorted[0], rows[1]);
  assert.equal(sorted[2], rows[2]);
  assert.equal(select(rows, '', 'unknown').length, 0);
  assert.equal(JSON.stringify(rows), before);
  assert.match(analytics, /if \(plan === 'free'\) return;/u);
  assert.match(analytics, /clearWorkTools\(\);/u);
});

test('search examples reuse the existing input path', () => {
  assert.equal((search.match(/data-natural-example="/gu) || []).length, 3);
  assert.match(search, /input\.dispatchEvent\(new Event\('input'\)\)/u);
  assert.match(search, /NovelightUserSafety\.filterNovelRows/u);
  assert.match(search, /NovelightR15\.filterRows/u);
});
