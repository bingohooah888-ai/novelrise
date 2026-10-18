import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { URL, URLSearchParams } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';

const [script, css, navigation, episode, seo] = await Promise.all([
  readFile('novelight-landscape-reader.js', 'utf8'),
  readFile('novelight-reading-settings.css', 'utf8'),
  readFile('novelight-reading-continuity.js', 'utf8'),
  readFile('episode.html', 'utf8'),
  readFile('api/seo/templates/episode.html', 'utf8')
]);

function readerFixture({
  landscape = true,
  nextEpisode = null,
  fullscreen = false,
  orientationLock = 'unsupported'
} = {}) {
  const events = new Map();
  const session = new Map();
  const calls = [];
  if (nextEpisode) {
    session.set('novelight:landscape-reader-next:v1', nextEpisode);
  }

  const body = {
    dataset: {},
    appendChild(node) {
      if (node.id === 'nlLandscapeReaderToggle') this.button = node;
    }
  };
  const button = {
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(name, fn) {
      this[name] = fn;
    }
  };
  const content = {
    isConnected: true,
    scrollWidth: 1000,
    clientWidth: 300,
    scrollLeft: -200,
    addEventListener(name, fn) {
      this[name] = fn;
    },
    removeEventListener() {}
  };
  const card = {
    querySelector(selector) {
      return selector === '.content' ? content : null;
    }
  };
  const media = {
    matches: landscape,
    addEventListener(name, fn) {
      assert.equal(name, 'change');
      this.onChange = fn;
    }
  };
  const document = {
    body,
    fullscreenElement: null,
    documentElement: {},
    getElementById(id) {
      if (id === 'card') return card;
      return id === 'nlLandscapeReaderToggle' ? body.button : null;
    },
    createElement(name) {
      assert.equal(name, 'button');
      return button;
    },
    addEventListener(name, fn) {
      events.set(name, fn);
    },
    dispatchEvent() {},
    async exitFullscreen() {
      calls.push('exitFullscreen');
      this.fullscreenElement = null;
    }
  };
  if (fullscreen) {
    document.documentElement.requestFullscreen = async () => {
      calls.push('requestFullscreen');
      document.fullscreenElement = document.documentElement;
    };
  }
  const settings = {
    load: () => ({ writingMode: 'horizontal', fontSize: 'standard' }),
    apply(next) {
      calls.push(next.writingMode);
      body.dataset.readingDirection = next.writingMode;
    },
    contentProgress(node) {
      return (Math.abs(node.scrollLeft) + node.clientWidth) / node.scrollWidth;
    },
    seekProgress(node, progress) {
      node.lastSeek = progress;
    }
  };
  const window = {
    NovelightReadingSettings: settings,
    innerWidth: landscape ? 844 : 390,
    innerHeight: landscape ? 390 : 844,
    location: {
      search: '?id=episode-2',
      href: 'https://novelight.jp/episode.html?id=episode-2'
    },
    matchMedia: () => media,
    requestAnimationFrame: (fn) => fn(),
    addEventListener() {},
    sessionStorage: {
      getItem: (key) => session.get(key) || null,
      setItem: (key, value) => session.set(key, value),
      removeItem: (key) => session.delete(key)
    }
  };
  if (orientationLock !== 'unsupported') {
    window.screen = {
      orientation: {
        async lock(value) {
          calls.push(value);
          if (orientationLock === 'denied') {
            throw new Error('orientation denied');
          }
          window.innerWidth = 844;
          window.innerHeight = 390;
          media.matches = true;
        },
        unlock() {
          calls.push('unlock');
        }
      }
    };
  }

  vm.runInNewContext(script, {
    window,
    document,
    URLSearchParams,
    URL,
    Event: globalThis.Event,
    MutationObserver: class {
      observe() {}
    },
    console
  });
  window.NovelightLandscapeReader.mount();
  return { body, button, content, document, media, session, events, calls };
}

test('tap immediately opens book view in portrait', () => {
  const view = readerFixture({ landscape: false });
  view.button.click();
  assert.equal(view.body.dataset.landscapeReader, 'active');
  assert.equal(view.body.dataset.landscapeReaderRotated, 'true');
  assert.equal(view.body.dataset.readingDirection, 'vertical');
  assert.equal(view.button.attributes['aria-pressed'], 'true');
  assert.equal(view.content.lastSeek, 0.5);
  assert.deepEqual(view.calls, ['vertical']);

  view.content.scrollLeft = -700;
  view.content.scroll();
  assert.equal(view.body.dataset.landscapeReaderAtEnd, 'true');

  view.button.click();
  assert.equal(view.body.dataset.landscapeReader, 'off');
  assert.equal(view.body.dataset.landscapeReaderRotated, undefined);
  assert.equal(view.body.dataset.readingDirection, 'horizontal');
  assert.equal(view.button.attributes['aria-pressed'], 'false');
  assert.deepEqual(view.calls, ['vertical', 'horizontal']);
});

test('fullscreen and landscape lock are requested on tap', async () => {
  const view = readerFixture({
    landscape: false,
    fullscreen: true,
    orientationLock: 'allowed'
  });
  view.button.click();
  await nextTurn();
  assert.deepEqual(view.calls.slice(0, 3), [
    'vertical',
    'requestFullscreen',
    'landscape'
  ]);
  assert.equal(view.body.dataset.landscapeReaderRotated, 'false');
  view.button.click();
  assert.ok(view.calls.includes('unlock'));
  assert.ok(view.calls.includes('exitFullscreen'));
  assert.equal(view.body.dataset.landscapeReader, 'off');
});

test('failed orientation lock uses rotated fullscreen view', async () => {
  const view = readerFixture({
    landscape: false,
    fullscreen: true,
    orientationLock: 'denied'
  });
  view.button.click();
  await nextTurn();
  assert.equal(view.body.dataset.landscapeReader, 'active');
  assert.equal(view.body.dataset.landscapeReaderRotated, 'true');
});

test('changing physical orientation does not dismiss reading mode', () => {
  const view = readerFixture({ landscape: false });
  view.button.click();
  view.media.matches = true;
  view.media.onChange();
  assert.equal(view.body.dataset.landscapeReader, 'active');
  view.media.matches = false;
  view.media.onChange();
  assert.equal(view.body.dataset.landscapeReader, 'active');
});

test('following Next preserves expanded mode without another gesture', () => {
  const view = readerFixture({ landscape: false });
  view.button.click();
  view.events.get('click')({
    target: {
      closest: () => ({
        href: 'https://novelight.jp/episode.html?id=episode-3'
      })
    }
  });
  assert.equal(
    view.session.get('novelight:landscape-reader-next:v1'),
    'episode-3'
  );

  const following = readerFixture({
    landscape: false,
    nextEpisode: 'episode-2'
  });
  assert.equal(following.body.dataset.landscapeReader, 'active');
  assert.equal(following.body.dataset.landscapeReaderRotated, 'true');
  assert.equal(following.session.size, 0);
});

test('rotated view keeps original content and Next', () => {
  for (const html of [episode, seo]) {
    assert.match(html, /novelight-landscape-reader\.js\?v=20261018c/);
    assert.match(html, /NovelightLandscapeReader\.mount\(\)/);
  }
  assert.match(script, /requestFullscreen/);
  assert.match(script, /orientation\.lock\('landscape'\)/);
  assert.doesNotMatch(script, /スマホを横向きにしてください/);
  assert.match(navigation, /nextLink\.dataset\.landscapeLabel/);
  assert.match(css, /data-landscape-reader-rotated='true'/);
  assert.match(css, /transform: rotate\(90deg\)/);
  assert.match(css, /width: 100dvh/);
  assert.match(css, /height: 100dvw/);
  assert.match(css, /content: attr\(data-landscape-label\)/);
  assert.match(css, /object-fit: contain/);
  assert.doesNotMatch(
    script,
    /record_valid_read_progress|reader_reading_progress|SCOUT_RECORD|LIGHT_SEED/
  );
});
