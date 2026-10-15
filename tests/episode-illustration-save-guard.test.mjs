import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync('episode-edit.html', 'utf8');
const illustrations = readFileSync(
  'novelight-episode-illustrations.js',
  'utf8'
);
const visual = readFileSync('novelight-episode-visual-editor.js', 'utf8');
const prefix = '[[NOVELIGHT_ILLUSTRATION:';
const marker = prefix + '12345678-1234-4234-8234-123456789abc]]';

function makeGuard(initialContent) {
  const head = html.indexOf('const insertedIllustrationMarkers=new Set();');
  const tail = html.indexOf('function saveFailureMessage(', head);
  assert.ok(head >= 0 && tail > head);
  const handlers = new Map();
  const sandbox = {
    window: {
      addEventListener(name, fn) {
        handlers.set(name, fn);
      }
    },
    episode: { content: initialContent }
  };
  const script = html.slice(head, tail);
  const expression = script + '\n({ illustrationSaveGuard })';
  const api = runInNewContext(expression, sandbox);
  return {
    guard: api.illustrationSaveGuard,
    fire(name) {
      handlers.get(name)?.({ detail: { marker } });
    }
  };
}

test('saving may not silently lose an inserted image', () => {
  const state = makeGuard('本文');
  state.fire('novelight:illustration-inserted');
  assert.throws(() => state.guard({ content: '本文' }));
  assert.doesNotThrow(() => state.guard({ content: '本文\n' + marker }));
});

test('saving may not silently lose an existing image', () => {
  const state = makeGuard('本文\n' + marker);
  assert.throws(() => state.guard({ content: '本文' }));
  assert.doesNotThrow(() => state.guard({ content: '本文\n' + marker }));
});

test('an explicit removal can be saved', () => {
  const state = makeGuard('本文\n' + marker);
  state.fire('novelight:illustration-removed');
  assert.doesNotThrow(() => state.guard({ content: '本文' }));
  state.fire('novelight:illustration-inserted');
  assert.throws(() => state.guard({ content: '本文' }));
});

test('published saves use revision compare and zero-row failure', () => {
  assert.ok(html.includes(".eq('updated_at',episode.updated_at)"));
  assert.ok(html.includes(".select('id,updated_at').maybeSingle()"));
  assert.ok(html.includes("error.code='EPISODE_STALE'"));
  assert.ok(html.includes("error.code='ILLUSTRATION_MARKERS_LOST'"));
});

test('both insertion paths and explicit removal notify the guard', () => {
  const insert = 'novelight:illustration-inserted';
  assert.equal(illustrations.split(insert).length - 1, 2);
  assert.ok(visual.includes('novelight:illustration-removed'));
  assert.ok(html.includes('illustrationSaveGuard(value)'));
});

function makePublishedSave(hasMatchingRow) {
  const start = html.indexOf('async function savePublishedEpisode(){');
  const end = html.indexOf('\nfunction markDirty()', start);
  assert.ok(start >= 0 && end > start);
  const checks = new Map();
  const query = {
    update() {
      return this;
    },
    eq(field, value) {
      checks.set(field, value);
      return this;
    },
    select() {
      return this;
    },
    async maybeSingle() {
      const data = hasMatchingRow
        ? { id: 2401, updated_at: 'new-version' }
        : null;
      return { data, error: null };
    }
  };
  const episode = {
    content: '本文',
    title: '第6話',
    updated_at: 'old-version'
  };
  const sandbox = {
    episode,
    id: 2401,
    session: { user: { id: 'owner' } },
    client: { from: () => query },
    collaborationEditor: false,
    values: () => ({
      title: '第6話',
      content: '本文\n' + marker,
      chapterId: null
    }),
    validate: () => '',
    illustrationSaveGuard: () => {}
  };
  const source = html.slice(start, end);
  const save = runInNewContext(source + '\nsavePublishedEpisode', sandbox);
  return { save, checks, episode };
}

test('a concurrent update is rejected instead of reported as saved', async () => {
  const state = makePublishedSave(false);
  await assert.rejects(state.save(), /別の画面などでこの話が更新/);
  assert.equal(state.checks.get('updated_at'), 'old-version');
});

test('a matching revision may save new markers', async () => {
  const state = makePublishedSave(true);
  await state.save();
  assert.equal(state.episode.updated_at, 'new-version');
  assert.ok(state.episode.content.includes(marker));
});
