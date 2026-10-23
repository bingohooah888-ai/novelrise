import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const script = readFileSync(
  new URL('../novelight-return-position.js', import.meta.url),
  'utf8'
);

function browser({
  pathname = '/index.html',
  search = '',
  navigationType = 'navigate',
  scrollY = 0,
  state = null,
  positions = {},
  tocScroll = null
} = {}) {
  const listeners = new Map();
  const nodes = new Map();
  const calls = [];
  let fallback;
  function add(name, handler) {
    const all = listeners.get(name) || [];
    all.push(handler);
    listeners.set(name, all);
  }
  const history = {
    state,
    scrollRestoration: 'auto',
    replaceState(next) {
      this.state = next;
    }
  };
  const window = {
    scrollY,
    NovelightNovelDetailV2: null,
    addEventListener: add,
    scrollTo(options) {
      this.scrollY = options.top;
      calls.push(options);
    },
    setTimeout(callback) {
      fallback = callback;
      return 1;
    }
  };
  function setElement(id, top) {
    nodes.set(id, {
      id,
      hidden: false,
      getClientRects: () => [{}],
      getBoundingClientRect: () => ({ top: top - window.scrollY })
    });
  }
  for (const [id, top] of Object.entries(positions)) setElement(id, top);
  const toc = tocScroll === null ? null : { scrollTop: tocScroll };
  const document = {
    addEventListener: add,
    querySelectorAll: () => [...nodes.values()],
    getElementById: (id) => nodes.get(id) || null,
    querySelector: () => toc
  };
  runInNewContext(script, {
    window,
    document,
    history,
    location: { pathname, search },
    performance: {
      getEntriesByType: () => [{ type: navigationType }]
    },
    requestAnimationFrame: (callback) => callback(),
    console: { warn() {} }
  });
  return {
    history,
    window,
    toc,
    calls,
    setElement,
    deleteElement: (id) => nodes.delete(id),
    dispatch(name, event = {}) {
      for (const handler of listeners.get(name) || []) handler(event);
    },
    fallback() {
      fallback?.();
    }
  };
}

test('saves a stable section ID without disabling browser scroll restoration', () => {
  const page = browser({
    scrollY: 1120,
    positions: { discover: 0, 'new-arrivals': 530, pricing: 1020 }
  });
  page.dispatch('pagehide');
  const snapshot = page.history.state.__novelightReturnPositionV1;
  assert.equal(snapshot.top, 1120);
  assert.equal(snapshot.anchor.id, 'pricing');
  assert.equal(snapshot.anchor.viewportTop, -100);
  assert.equal(page.history.scrollRestoration, 'auto');
});

test('restores by ID after asynchronously reordered sections, only once', () => {
  const original = browser({
    scrollY: 1120,
    positions: { discover: 0, 'new-arrivals': 530, pricing: 1020 }
  });
  original.dispatch('pagehide');
  const returned = browser({
    navigationType: 'back_forward',
    state: original.history.state,
    positions: { pricing: 1560, discover: 0, 'new-arrivals': 1100 }
  });
  returned.dispatch('DOMContentLoaded');
  assert.equal(returned.calls.length, 0);
  returned.dispatch('novelight:page-content-ready');
  assert.equal(returned.window.scrollY, 1660);
  returned.dispatch('novelight:page-content-ready');
  returned.fallback();
  assert.equal(returned.calls.length, 1);
  assert.equal(returned.history.scrollRestoration, 'auto');
});

test('touch interaction before async completion cancels automatic scroll', () => {
  const original = browser({
    scrollY: 680,
    positions: { discover: 500 }
  });
  original.dispatch('pagehide');
  const returned = browser({
    navigationType: 'back_forward',
    state: original.history.state,
    positions: { discover: 830 }
  });
  returned.dispatch('touchstart');
  returned.dispatch('novelight:page-content-ready');
  returned.fallback();
  assert.equal(returned.calls.length, 0);
});

test('waits for work detail grid and restores the internal TOC position', () => {
  const original = browser({
    pathname: '/novel.html',
    search: '?id=book',
    scrollY: 700,
    positions: { novelightWorkDetailGrid: 620 },
    tocScroll: 245
  });
  original.dispatch('pagehide');
  assert.equal(
    original.history.state.__novelightReturnPositionV1.anchor.id,
    'novelightWorkDetailGrid'
  );

  const returned = browser({
    pathname: '/novel.html',
    search: '?id=book',
    navigationType: 'back_forward',
    state: original.history.state,
    positions: { novelHeader: 500 },
    tocScroll: 0
  });
  returned.window.NovelightNovelDetailV2 = {};
  returned.dispatch('novelight:page-content-ready');
  assert.equal(returned.calls.length, 0);
  returned.deleteElement('novelHeader');
  returned.setElement('novelightWorkDetailGrid', 930);
  returned.dispatch('novelight:page-content-ready');
  assert.equal(returned.window.scrollY, 1010);
  assert.equal(returned.toc.scrollTop, 245);
});

test('BFCache preserves browser scroll without a forced jump', () => {
  const original = browser({
    scrollY: 400,
    positions: { pricing: 350 }
  });
  original.dispatch('pagehide');
  const returned = browser({
    navigationType: 'back_forward',
    state: original.history.state,
    positions: { pricing: 500 }
  });
  returned.dispatch('pageshow', { persisted: true });
  returned.dispatch('novelight:page-content-ready');
  assert.equal(returned.calls.length, 0);
});

test('mobile heading and tap-state navigation overrides are present', () => {
  const heading = readFileSync(
    new URL('../novelight-page-heading.css', import.meta.url),
    'utf8'
  );
  const shell = readFileSync(
    new URL('../novelight-author-studio-shell.css', import.meta.url),
    'utf8'
  );
  const legacy = readFileSync(
    new URL('../novelight-legacy-surfaces.css', import.meta.url),
    'utf8'
  );
  assert.match(
    heading,
    /@media \(max-width: 720px\)[\s\S]*?flex-basis: auto !important/u
  );
  assert.match(
    shell,
    /#menuToggle:is\(:hover, :active, :focus, :focus-visible\)/u
  );
  assert.match(
    legacy,
    /button:where\(:not\(\.mobile-menu, \.nav-scrim\)\):hover/u
  );
});
