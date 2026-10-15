import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync('episode-edit.html', 'utf8');
const illustrations = readFileSync('novelight-episode-illustrations.js', 'utf8');
const visual = readFileSync('novelight-episode-visual-editor.js', 'utf8');

function makeGuard(initialContent) {
  const head = html.indexOf('const insertedIllustrationMarkers=new Set();');
  const tail = html.indexOf('function saveFailureMessage(', head);
  assert.ok(head >= 0 && tail > head);
  const handlers = new Map();
  const fakeWindow = {
    addEventListener(name, callback) {
      handlers.set(name, callback);
    }
  };
  const sandbox = {
    window: fakeWindow,
    episode: { content: initialContent }
  };
  const code = html.slice(head, tail);
  const expose = '\n({ illustrationSaveGuard, markersIn })';
  const guard = runInNewContext(code + expose, sandbox);
  return {
    guard: guard.illustrationSaveGuard,
    fire(name, marker) {
      handlers.get(name)?.({ detail: { marker } });
    }
  };
}

const marker = '[[NOVELIGHT_ILLUSTRATION:' +
  '12345678-1234-4234-8234-123456789abc]]';

test('newly inserted image cannot disappear in submitted body', () => {
  const state = makeGuard('既存本文');
  state.fire('novelight:illustration-inserted', marker);
  assert.throws(
    () => state.guard({ content: '既存本文' }),
    /挿絵の参照が本文から消えた/
  );
  assert.doesNotThrow(() => {
    state.guard({ content: '既存本文\n' + marker });
  });
});

test('a preexisting referenced image cannot be silently lost', () => {
  const state = makeGuard('既存本文\n' + marker);
  assert.throws(() => state.guard({ content: '既存本文' }));
  assert.doesNotThrow(() => {
    state.guard({ content: '既存本文\n' + marker });
  });
});

test('explicit editor removal is allowed but accidental loss is not', () => {
  const state = makeGuard('既存本文\n' + marker);
  state.fire('novelight:illustration-removed', marker);
  assert.doesNotThrow(() => state.guard({ content: '既存本文' }));
  state.fire('novelight:illustration-inserted', marker);
  assert.throws(() => state.guard({ content: '既存本文' }));
});

test('stale edit saves are conditioned on loaded database revision', () => {
  assert.ok(html.includes(".eq('updated_at',episode.updated_at)"));
  assert.ok(html.includes(".select('id,updated_at').maybeSingle()"));
  assert.ok(html.includes("error.code='EPISODE_STALE'"));
  assert.ok(html.includes("error.code='ILLUSTRATION_MARKERS_LOST'"));
});

test('all illustration placement and removal paths signal the guard', () => {
  const insertion = "novelight:illustration-inserted";
  assert.equal(illustrations.split(insertion).length - 1, 2);
  assert.ok(visual.includes("novelight:illustration-removed"));
  assert.ok(html.includes('illustrationSaveGuard(value)'));
});
