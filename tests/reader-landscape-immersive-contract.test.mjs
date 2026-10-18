import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { URL, URLSearchParams } from 'node:url';

const [script, css, navigation, episode, seo] = await Promise.all([
  readFile('novelight-landscape-reader.js', 'utf8'),
  readFile('novelight-reading-settings.css', 'utf8'),
  readFile('novelight-reading-continuity.js', 'utf8'),
  readFile('episode.html', 'utf8'),
  readFile('api/seo/templates/episode.html', 'utf8')
]);

function readerFixture({ landscape = true, nextEpisode = null } = {}) {
  const events = new Map();
  const session = new Map();
  if (nextEpisode) {
    session.set('novelight:landscape-reader-next:v1', nextEpisode);
  }

  const body = {
    dataset: {},
    appendChild(node) {
      if (node.id === 'nlLandscapeReaderToggle') this.button = node;
      if (node.id === 'nlLandscapeReaderHint') this.hint = node;
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
  const hint = {
    hidden: true,
    setAttribute() {}
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
  const document = {
    body,
    getElementById(id) {
      if (id === 'card') return card;
      return id === 'nlLandscapeReaderToggle' ? body.button : null;
    },
    createElement(name) {
      if (name === 'button') return button;
      assert.equal(name, 'div');
      return hint;
    },
    addEventListener(name, fn) {
      events.set(name, fn);
    },
    dispatchEvent() {}
  };
  const media = {
    matches: landscape,
    addEventListener(name, fn) {
      assert.equal(name, 'change');
      this.onChange = fn;
    }
  };
  const applied = [];
  const settings = {
    load: () => ({ writingMode: 'horizontal', fontSize: 'standard' }),
    apply(next) {
      applied.push(next.writingMode);
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
    location: {
      search: '?id=episode-2',
      href: 'https://novelight.jp/episode.html?id=episode-2'
    },
    matchMedia: () => media,
    requestAnimationFrame: (fn) => fn(),
    sessionStorage: {
      getItem: (key) => session.get(key) || null,
      setItem: (key, value) => session.set(key, value),
      removeItem: (key) => session.delete(key)
    }
  };

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
  return {
    body,
    button,
    hint,
    content,
    document,
    media,
    session,
    events,
    applied
  };
}

test('landscape expands, tracks the end, and restores writing mode', () => {
  const fixture = readerFixture();
  const { body, button, content, applied } = fixture;
  assert.equal(body.dataset.landscapeReaderReady, 'true');
  assert.equal(body.dataset.landscapeReader, undefined);

  button.click();
  assert.equal(body.dataset.landscapeReader, 'active');
  assert.equal(body.dataset.readingDirection, 'vertical');
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.equal(content.lastSeek, 0.5);
  assert.equal(body.dataset.landscapeReaderAtEnd, 'false');

  content.scrollLeft = -700;
  content.scroll();
  assert.equal(body.dataset.landscapeReaderAtEnd, 'true');

  button.click();
  assert.equal(body.dataset.landscapeReader, 'off');
  assert.equal(body.dataset.readingDirection, 'horizontal');
  assert.equal(button.attributes['aria-pressed'], 'false');
  assert.equal(body.dataset.landscapeReaderAtEnd, undefined);
  assert.deepEqual(applied, ['vertical', 'horizontal']);
});

test('Next click alone opts the following episode into book mode', () => {
  const fixture = readerFixture();
  const { button, events, session } = fixture;
  button.click();
  events.get('click')({
    target: {
      closest: () => ({
        href: 'https://novelight.jp/episode.html?id=episode-3'
      })
    }
  });
  assert.equal(session.get('novelight:landscape-reader-next:v1'), 'episode-3');

  const next = readerFixture({ nextEpisode: 'episode-2' });
  assert.equal(next.body.dataset.landscapeReader, 'active');
  assert.equal(next.session.size, 0, 'handoff is consumed after navigation');
});

test('portrait entry stays visible and activates after rotation', () => {
  const portrait = readerFixture({ landscape: false });
  assert.equal(portrait.body.dataset.landscapeReaderReady, 'true');
  assert.equal(portrait.button.attributes['aria-pressed'], 'false');
  portrait.button.click();
  assert.equal(portrait.body.dataset.landscapeReader, undefined);
  assert.equal(portrait.hint.hidden, false);
  portrait.media.matches = true;
  portrait.media.onChange();
  assert.equal(portrait.body.dataset.landscapeReader, 'active');
  assert.equal(portrait.hint.hidden, true);
  portrait.media.matches = false;
  portrait.media.onChange();
  assert.equal(portrait.body.dataset.landscapeReader, 'off');

  const following = readerFixture({
    landscape: false,
    nextEpisode: 'episode-2'
  });
  assert.equal(following.hint.hidden, false);
  following.media.matches = true;
  following.media.onChange();
  assert.equal(following.body.dataset.landscapeReader, 'active');
});

test('book mode reuses Next and excludes social and action panels', () => {
  for (const html of [episode, seo]) {
    assert.match(html, /novelight-landscape-reader\.js/);
    assert.match(html, /NovelightLandscapeReader\.mount\(\)/);
  }
  assert.match(navigation, /nextLink\.dataset\.landscapeLabel/);
  assert.match(navigation, /話に進む/);
  assert.match(css, /#card \.content\s*\{/);
  assert.match(css, /position: fixed/);
  assert.match(
    css,
    /@media \(max-width: 960px\), \(pointer: coarse\), \(hover: none\)/
  );
  assert.match(css, /data-landscape-reader-ready='true'/);
  assert.match(css, /height: 100dvh/);
  assert.match(css, /#nlReadingNav \.nl-reading-link:not\(\.next\)/);
  assert.match(css, /content: attr\(data-landscape-label\)/);
  assert.match(css, /object-fit: contain/);
  assert.doesNotMatch(
    script,
    /record_valid_read_progress|reader_reading_progress|SCOUT_RECORD|LIGHT_SEED/
  );
});
