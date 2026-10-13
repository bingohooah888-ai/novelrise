import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const continuity = readFileSync(
  new URL('../novelight-reading-continuity.js', import.meta.url),
  'utf8'
);
const source = readFileSync(
  new URL('../novelight-contest-read-tracker.js', import.meta.url),
  'utf8'
);

function browser(enabled) {
  const events = new Map();
  const documentEvents = new Map();
  const requests = [];
  let interval = null;
  const doc = {
    visibilityState: 'visible',
    addEventListener(name, fn) {
      documentEvents.set(name, fn);
    }
  };
  const win = {
    NOVELIGHT_CONTEST_READER_CLIENT_ENABLED: enabled,
    document: doc,
    innerHeight: 500,
    addEventListener(name, fn) {
      events.set(name, fn);
    },
    fetch: async (_path, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        async json() {
          return requests.length === 1
            ? { ok: true, session_id: 'test-session-id' }
            : { ok: true, qualified: false };
        }
      };
    },
    setInterval(fn, delay) {
      interval = fn;
      assert.equal(delay, 12000);
      return 1;
    },
    clearInterval() {
      interval = null;
    }
  };
  runInNewContext(source, { window: win });
  return {
    doc,
    requests,
    documentEvents,
    events,
    tick() {
      return interval?.();
    }
  };
}

test('inactive contest browser adapter makes zero requests and mounts nothing', () => {
  const b = browser(false);
  assert.equal(b.documentEvents.size, 0);
  assert.equal(b.requests.length, 0);
});

test('active adapter sends bounded scroll evidence and stops on hidden tabs', async () => {
  const b = browser(true);
  b.documentEvents.get('novelight:episode-rendered')({
    detail: {
      unlocked: true,
      isAuthor: false,
      episode: { id: 32 },
      session: null,
      content: {
        scrollHeight: 1000,
        getBoundingClientRect: () => ({ top: 0, height: 1000 })
      }
    }
  });
  b.events.get('scroll')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(b.requests[0], {
    action: 'start',
    episode_id: 32,
    mode: 'scroll'
  });
  await b.tick();
  assert.equal(b.requests[1].action, 'heartbeat');
  assert.equal(b.requests[1].progress_ratio, 0.5);
  assert.equal(b.requests[1].foreground, true);
  b.doc.visibilityState = 'hidden';
  b.documentEvents.get('visibilitychange')();
  assert.equal(b.tick(), undefined);
  assert.equal(b.requests.length, 2);
});

test('episode render contract fires only after unlock and existing PV remains separate', () => {
  assert.match(continuity, /novelight:episode-rendered/);
  assert.match(continuity, /novelight-contest-read-tracker[.]js/);
  assert.match(continuity, /installContestReadTracker\(row, content\)/);
  assert.match(source, /NOVELIGHT_CONTEST_READER_CLIENT_ENABLED !== true/);
  assert.doesNotMatch(source, /record_valid_read_progress|record_episode_pv/);
  assert.match(source, /novelight:tts-progress/);
  assert.match(source, /data-tts-action/);
  assert.match(source, /credentials: 'same-origin'/);
});
