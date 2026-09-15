import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const resumeSource = await readFile('novelight-home-resume.js', 'utf8');
const authReaderSource = await readFile('auth-reader-context.js', 'utf8');

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    }
  };
}

function loadResumeApi(storage = createStorage()) {
  const window = {
    location: { pathname: '/search.html' },
    localStorage: storage
  };
  vm.runInNewContext(resumeSource, {
    window,
    console,
    Date,
    JSON,
    Math,
    Number,
    Object,
    String
  });
  return window.NovelightHomeResume;
}

test(
  'home resume reads only valid NOVELIGHT progress and orders it newest first',
  () => {
    const storage = createStorage({
      'novelight:reading:v1:novel-old': JSON.stringify({
        novelId: 'novel-old',
        episodeId: 'ep-1',
        episodeNumber: 1,
        progressRatio: 0.4,
        lastReadAt: '2026-09-14T10:00:00.000Z'
      }),
      'novelight:reading:v1:novel-new': JSON.stringify({
        novelId: 'novel-new',
        episodeId: 'ep-7',
        episodeNumber: 7,
        progressRatio: 0.6,
        lastReadAt: '2026-09-15T10:00:00.000Z'
      }),
      'novelight:reading:v1:mismatch': JSON.stringify({
        novelId: 'different',
        episodeId: 'ep-x',
        lastReadAt: '2026-09-16T10:00:00.000Z'
      }),
      'novelight:reading:v1:broken': '{not-json',
      unrelated: JSON.stringify({ novelId: 'ignore', episodeId: 'ignore' })
    });
    const api = loadResumeApi(storage);
    const rows = api.readRecentProgress(storage);

    assert.deepEqual(
      Array.from(rows, (row) => row.novelId),
      ['novel-new', 'novel-old']
    );
  }
);

test(
  'home resume continues the current episode until 85 percent, then advances',
  () => {
    const api = loadResumeApi();
    const episodes = [
      { id: 'ep-1', episode_number: 1 },
      { id: 'ep-2', episode_number: 2 },
      { id: 'ep-3', episode_number: 3 }
    ];

    assert.equal(
      api.continueTarget(episodes, { episodeId: 'ep-2', progressRatio: 0.84 }).id,
      'ep-2'
    );
    assert.equal(
      api.continueTarget(episodes, { episodeId: 'ep-2', progressRatio: 0.85 }).id,
      'ep-3'
    );
    assert.equal(
      api.continueTarget(episodes, { episodeId: 'removed', progressRatio: 1 }).id,
      'ep-1'
    );
  }
);

test(
  'home resume validates published novel and episode state without server-side writes',
  () => {
    assert.match(resumeSource, /from\('novels'\)/);
    assert.match(resumeSource, /\.eq\('status', 'published'\)/);
    assert.match(resumeSource, /from\('episodes'\)/);
    assert.doesNotMatch(resumeSource, /\.(?:insert|update|upsert|delete)\s*\(/);
    assert.match(resumeSource, /この端末の読書履歴から表示しています/);
  }
);

test(
  'home page schedules the resume enhancement after DOMContentLoaded only',
  () => {
    assert.match(authReaderSource, /novelight-home-resume\.js/);
    assert.match(authReaderSource, /DOMContentLoaded/);
    assert.match(
      authReaderSource,
      /pathname === '\/' \|\| pathname\.endsWith\('\/index\.html'\)/
    );
  }
);
