import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const help = await readFile('novelight-help.js', 'utf8');
const notes = await readFile('story-notes.html', 'utf8');
const glossary = await readFile('novelight-private-story-package.js', 'utf8');
const editor = await readFile('novel-edit.html', 'utf8');
const admin = await readFile('admin-analytics.html', 'utf8');

test('help searches the existing catalog without generating answers', () => {
  const context = {
    window: {},
    document: {
      querySelector: () => true,
      readyState: 'loading',
      addEventListener() {}
    }
  };
  vm.runInNewContext(help, context);
  const api = context.window.NovelightHelp;
  assert.ok(api.searchTopics('予約公開').some((row) => row.key === 'publishing'));
  assert.equal(api.searchTopics('').length, 0);
  assert.equal(api.searchTopics('x'.repeat(121)).length, 0);
  assert.equal(api.searchTopics('不存在の検索語xyz').length, 0);
  assert.match(help, /見つからない場合はお問い合わせへ/u);
});

test('world index only returns existing private world notes', () => {
  const context = { window: {} };
  vm.runInNewContext(glossary, context);
  const api = context.window.NovelightPrivateStoryPackage;
  const rows = [
    { note_type: 'world', title: 'B', body: '王国' },
    { note_type: 'character', title: 'A', body: '秘密' },
    { note_type: 'world', title: 'A', body: '組織' }
  ];
  const before = JSON.stringify(rows);
  const entries = api.glossaryEntries(rows);
  assert.deepEqual(
    Array.from(entries, (item) => item.title),
    ['A', 'B']
  );
  assert.equal(JSON.stringify(rows), before);
  assert.ok(!JSON.stringify(entries).includes('秘密'));
  assert.equal(
    api.packageCounts(rows).find((item) => item.key === 'world').count,
    2
  );
  assert.match(notes, /作者専用の世界観・用語索引/u);
  assert.match(notes, /id="privateGlossarySearch"/u);
  assert.match(notes, /if\(!packageSnapshotValid\)\{panel.hidden=true/u);
  assert.match(notes, /保存済み資料：/u);
});

test('metadata comparison does not modify editor or save candidate B', () => {
  const start = editor.indexOf('function metadataComparison(');
  const end = editor.indexOf('\nconst comparison=', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(editor.slice(start, end), context);
  const compare = context.metadataComparison;
  assert.equal(compare('A😀', 'B').aLength, 2);
  assert.equal(compare(' A ', 'A').same, true);
  assert.equal(compare('A', ' '), null);
  const save = editor.slice(editor.indexOf("form.addEventListener('submit'"));
  assert.doesNotMatch(save, /compareTitleB|compareDescriptionB/u);
  assert.match(editor, /実際のA\/B配信やクリック率測定ではありません/u);
  assert.match(editor, /作品分類の手動確認/u);
});

test('KPI checks distinguish missing values from actual zero', () => {
  const start = admin.indexOf('  const kpiFields=');
  const end = admin.indexOf('  function clearKpiTools(', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(admin.slice(start, end), context);
  const report = context.kpiSnapshot({
    rangeDays: 30,
    usage: { uniqueVisitors: 0, readingUsers: null, newUsers: -1 },
    discovery: { zeroPvRate: 101, workExposureGini: 0.25 }
  });
  assert.equal(report.days, 30);
  assert.equal(report.rows[0].value, 0);
  assert.equal(report.rows[1].reason, '未取得');
  assert.equal(report.rows[2].reason, '数値範囲を確認');
  assert.equal(report.rows[5].value, null);
  assert.equal(report.rows[6].value, 0.25);
  assert.equal(context.kpiSnapshot({ rangeDays: 14 }).days, null);
  assert.match(admin, /時系列異常・原因は判定していません/u);
});
