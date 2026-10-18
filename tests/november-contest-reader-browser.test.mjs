import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { setImmediate as waitForMicrotasks } from 'node:timers/promises';
import test from 'node:test';

const continuity = readFileSync(
  new URL('../novelight-reading-continuity.js', import.meta.url),
  'utf8'
);
const tts = readFileSync(
  new URL('../novelight-reader-tts.js', import.meta.url),
  'utf8'
);
const source = readFileSync(
  new URL('../novelight-contest-read-tracker.js', import.meta.url),
  'utf8'
);

function browser(enabled, { vertical = false } = {}) {
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
      const message = JSON.parse(options.body);
      requests.push(message);
      return {
        ok: true,
        async json() {
          if (message.action === 'link') {
            return { ok: true, linked: true };
          }
          if (message.action === 'start') {
            return { ok: true, session_id: 'test-session-id' };
          }
          return { ok: true, qualified: false };
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
  if (vertical) {
    win.NovelightReadingSettings = {
      contentProgress(content) {
        return (
          Math.abs(content.scrollLeft) + content.clientWidth
        ) / content.scrollWidth;
      }
    };
  }
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
  await waitForMicrotasks();
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

test('immersive vertical scroll forwards the same progress to contest heartbeats', async () => {
  const b = browser(true, { vertical: true });
  const content = {
    scrollWidth: 1000,
    clientWidth: 300,
    scrollLeft: -500,
    addEventListener(name, fn) {
      if (name === 'scroll') this.onScroll = fn;
    }
  };
  b.documentEvents.get('novelight:episode-rendered')({
    detail: {
      unlocked: true,
      isAuthor: false,
      episode: { id: 32 },
      session: null,
      content
    }
  });
  content.onScroll({ type: 'scroll', target: content });
  await waitForMicrotasks();
  await b.tick();
  assert.equal(b.requests[0].action, 'start');
  assert.equal(b.requests[1].action, 'heartbeat');
  assert.equal(b.requests[1].progress_ratio, 0.8);
});

test('episode render contract fires only after unlock and existing PV remains separate', () => {
  assert.match(continuity, /novelight:episode-rendered/);
  assert.ok(continuity.includes('november-contest-reader-ready?episode_id='));
  assert.ok(continuity.includes('result?.enabled === true'));
  assert.ok(
    continuity.includes('window.NOVELIGHT_CONTEST_READER_CLIENT_ENABLED = true')
  );
  assert.match(continuity, /novelight-contest-read-tracker[.]js/);
  assert.match(
    continuity,
    /installContestReadTracker\(row, content, clientInstance\)/
  );
  assert.match(source, /NOVELIGHT_CONTEST_READER_CLIENT_ENABLED !== true/);
  assert.doesNotMatch(source, /record_valid_read_progress|record_episode_pv/);
  assert.match(source, /novelight:tts-progress/);
  assert.match(source, /novelight:tts-state/);
  assert.doesNotMatch(source, /data-tts-action/);
  assert.match(source, /credentials: 'same-origin'/);
  assert.match(continuity, /clientInstance[.]auth[.]getSession\(\)/);
  assert.match(source, /action: 'link'/);
});

test('authenticated read links signed guest evidence before session creation', async () => {
  const b = browser(true);
  b.documentEvents.get('novelight:episode-rendered')({
    detail: {
      unlocked: true,
      isAuthor: false,
      episode: { id: 32 },
      session: { access_token: 'test-access-token' },
      content: {
        scrollHeight: 1000,
        getBoundingClientRect: () => ({ top: 0, height: 1000 })
      }
    }
  });
  b.events.get('scroll')();
  await waitForMicrotasks();
  await waitForMicrotasks();
  assert.equal(b.requests[0].action, 'link');
  assert.equal(b.requests[1].action, 'start');
  await b.tick();
  assert.equal(b.requests[2].action, 'heartbeat');
});

test('TTS requires a playback state signal, not a button click', async () => {
  const b = browser(true);
  b.documentEvents.get('novelight:episode-rendered')({
    detail: {
      unlocked: true,
      isAuthor: false,
      episode: { id: 55 },
      session: null,
      content: {
        scrollHeight: 1000,
        getBoundingClientRect: () => ({ top: 0, height: 1000 })
      }
    }
  });
  assert.equal(b.requests.length, 0);
  b.documentEvents.get('novelight:tts-state')({
    detail: { state: 'playing' }
  });
  await waitForMicrotasks();
  assert.equal(b.requests[0].action, 'start');
  assert.equal(b.requests[0].mode, 'tts');
  b.documentEvents.get('novelight:tts-progress')({
    detail: { ratio: 0.82 }
  });
  await b.tick();
  assert.equal(b.requests[1].action, 'heartbeat');
  assert.equal(b.requests[1].progress_ratio, 0.82);
  b.documentEvents.get('novelight:tts-state')({
    detail: { state: 'paused' }
  });
  assert.equal(b.tick(), undefined);
  assert.match(tts, /utterance[.]onstart =/);
  assert.match(tts, /reportContestSpeechState\('playing'\)/);
  assert.match(tts, /reportContestSpeechState\('paused'\)/);
  assert.match(tts, /reportContestSpeechState\('stopped'\)/);
  assert.match(tts, /reportContestSpeechState\('ended'\)/);
});

test('TTS completion does not count as an immediate full read', async () => {
  const b = browser(true);
  b.documentEvents.get('novelight:episode-rendered')({
    detail: {
      unlocked: true,
      isAuthor: false,
      episode: { id: 56 },
      session: null,
      content: {
        scrollHeight: 1000,
        getBoundingClientRect: () => ({ top: 0, height: 1000 })
      }
    }
  });
  b.documentEvents.get('novelight:tts-state')({
    detail: { state: 'playing' }
  });
  await waitForMicrotasks();
  b.documentEvents.get('novelight:tts-progress')({
    detail: { ratio: 1, completed: true }
  });
  b.documentEvents.get('novelight:tts-state')({
    detail: { state: 'ended' }
  });
  await waitForMicrotasks();
  assert.equal(b.requests.length, 2);
  assert.equal(b.requests[1].action, 'heartbeat');
  assert.equal(b.requests[1].progress_ratio, 1);
  assert.equal(b.tick(), undefined);
});
