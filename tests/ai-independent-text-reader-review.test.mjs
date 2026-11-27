import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFile(path, 'utf8');
const notes = await read('story-notes.html');
const helper = await read('novelight-private-story-package.js');
const navigation = await read('novelight-work-navigation.js');
const history = await read('novelight-reading-history.js');
const search = await read('search.html');
const trust = await read('admin-trust-safety.html');
const community = await read('admin-community.html');
const browser = { window: {} };
vm.runInNewContext(helper, browser);
vm.runInNewContext(await read('novelight-episode-title-display.js'), browser);
vm.runInNewContext(navigation, browser);
vm.runInNewContext(history, browser);

function extract(source, first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(source.slice(start, end), context);
  return context;
}

test('passage comparison is bounded and reports line locations only', () => {
  const api = browser.window.NovelightPrivateStoryPackage;
  const passage = 'abcdefghijklmnopqrst';
  const match = api.comparePassages(passage, '別\n' + passage);
  assert.equal(match.shared, 1);
  assert.equal(match.candidateWindows, 2);
  assert.deepEqual(Array.from(match.lineCandidates), [2]);
  assert.ok(!JSON.stringify(match).includes(passage));
  assert.equal(api.comparePassages('short', passage), null);
  assert.equal(api.comparePassages('x'.repeat(12001), passage), null);
  assert.equal(api.comparePassages(passage, 'z'.repeat(20)).shared, 0);
  assert.match(notes, /sameOwner\(packageOwnerSession,current.data\?\.session\)/u);
});

test('translation checks are literal counts and reject ambiguous input', () => {
  const api = browser.window.NovelightPrivateStoryPackage;
  const result = api.checkTranslationTerms(
    '王都から王都へ',
    'Royal Capital',
    '王都\tRoyal Capital'
  );
  assert.equal(result[0].sourceCount, 2);
  assert.equal(result[0].targetCount, 1);
  assert.equal(result[0].review, true);
  assert.equal(api.checkTranslationTerms('王都', 'x', '王都'), null);
  assert.equal(
    api.checkTranslationTerms('王都', 'x', '王都\tx\n王都\ty'),
    null
  );
});

test('prior episode links reject unknown position and future rows', () => {
  const api = browser.window.NovelightWorkNavigation;
  const rows = [
    { id: 1, number: 1 },
    { id: 2, number: 2 },
    { id: 3, number: 3 },
    { id: 4, number: 4 },
    { id: 5, number: 5 },
    { id: 6, number: 6, title: 'future' }
  ];
  const before = JSON.stringify(rows);
  const past = api.priorEpisodeLinks(rows, 5);
  assert.deepEqual(
    Array.from(past, (row) => row.id),
    [4, 3, 2]
  );
  assert.equal(api.priorEpisodeLinks(rows, 99).length, 0);
  assert.equal(api.priorEpisodeLinks([...rows, rows[4]], 5).length, 0);
  assert.equal(JSON.stringify(rows), before);
});

test('genre discovery uses an explicit choice and neutral search', () => {
  const api = browser.NovelightReadingHistory;
  assert.equal(api.genreSearchHref('SF'), 'search.html?sort=new&genre=SF');
  assert.equal(api.genreSearchHref('unknown'), null);
  assert.match(search, /option.value===requestedGenre/u);
  assert.match(search, /genrePicker.value=requestedGenre/u);
  assert.match(search, /NovelightUserSafety\.filterNovelRows/u);
});

test('evidence inventory excludes inactive rows without making decisions', () => {
  const api = extract(
    trust,
    'function reviewEvidenceInventory(',
    'function evidenceText('
  );
  const user = {
    signals: [
      { status: 'active', signal_type: 'a' },
      { status: 'confirmed', signal_type: 'a' },
      { status: 'dismissed', signal_type: 'b' }
    ],
    links: [{ status: 'active' }, { status: 'dismissed' }]
  };
  const result = api.reviewEvidenceInventory(user);
  assert.equal(result.active, 1);
  assert.equal(result.confirmed, 1);
  assert.deepEqual(Array.from(result.types), ['a']);
  assert.equal(result.activeLinks, 1);
  assert.match(api.reviewEvidenceText(user), /不正の確定・処分は行いません/u);
});

test('community groups do not merge different post keys', () => {
  const api = extract(
    community,
    ' function groupPostReports(',
    ' function renderReportGroups('
  );
  const rows = [
    { post_key: 'a' },
    { post_key: 'ab' },
    { post_key: 'a' },
    { post_key: '' }
  ];
  const before = JSON.stringify(rows);
  const groups = api.groupPostReports(rows);
  assert.equal(JSON.stringify(groups), '[{"key":"a","count":2}]');
  assert.equal(JSON.stringify(rows), before);
  assert.match(community, /exactPost!==null\?row.post_key===exactPost/u);
});
