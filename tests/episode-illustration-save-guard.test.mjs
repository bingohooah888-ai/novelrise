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
