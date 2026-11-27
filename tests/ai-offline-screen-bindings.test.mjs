import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const context = {};
vm.runInNewContext(
  await readFile('novelight-ai-review-result.js', 'utf8'),
  context
);
const api = context.NovelightAiReviewResult;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('screen selection follows the existing bounded input contracts', () => {
  const base = { novelId: '1', episodeIds: ['2'] };
  assert.deepEqual(plain(api.projectSelection('work-analysis', base)), base);
  assert.equal(
    api.projectSelection('work-analysis', { ...base, body: 'private' }),
    null
  );
  assert.equal(
    api.projectSelection('writing-assistant', {
      novelId: '1',
      episodeIds: ['2', '3']
    }),
    null
  );
  assert.equal(api.projectSelection('target-reader-analysis', {}), null);
  const search = { query: '冒険', genre: '', tagIds: [] };
  assert.deepEqual(
    plain(api.projectSelection('natural-search-ai', search)),
    search
  );
  assert.equal(
    api.projectSelection('natural-search-ai', { ...search, token: 'jwt' }),
    null
  );
  assert.equal(api.projectSelection('kpi-anomaly', { days: 1 }), null);
  assert.equal(
    api.projectSelection('inquiry-assistant', {
      inquiryId: '1',
      reviewedBodyHash: 'a'.repeat(64),
      ranges: [{ offset: 0, length: 3 }],
      privacyReviewed: false
    }),
    null
  );
});

function fixture() {
  const events = new Map();
  const doc = {
    createElement(tag) {
      return {
        tag,
        ownerDocument: doc,
        childNodes: [],
        textContent: '',
        hidden: false,
        appendChild(node) {
          this.childNodes.push(node);
        },
        replaceChildren() {
          this.childNodes = [];
        },
        setAttribute() {}
      };
    },
    querySelector() {
      return root;
    },
    addEventListener(name, fn) {
      events.set(name, fn);
    },
    defaultView: {
      addEventListener(name, fn) {
        events.set(name, fn);
      }
    }
  };
  const root = doc.createElement('section');
  const client = {
    auth: {
      onAuthStateChange(fn) {
        events.set('auth', fn);
      }
    }
  };
  return { root, doc, client, events };
}

test('result delivery rejects stale, cross-feature and invalid-scope data', () => {
  const { root } = fixture();
  let current = true;
  const screen = api.createScreenController(
    root,
    ['work-analysis'],
    () => current
  );
  const selection = { novelId: '1', episodeIds: ['2'] };
  const first = screen.begin('work-analysis', selection);
  const second = screen.begin('work-analysis', selection);
  const answer = {
    featureKey: 'work-analysis',
    result: { kind: 'work_analysis_candidates', items: [{ quote: '原文' }] }
  };
  assert.equal(screen.present(first.ticket, answer), false);
  assert.equal(root.childNodes.length, 0);
  assert.equal(screen.present(second.ticket, answer), false);
  const next = screen.begin('work-analysis', selection);
  assert.equal(screen.present(next.ticket, answer), true);
  assert.ok(root.childNodes.length > 0);
  const another = screen.begin('work-analysis', selection);
  current = false;
  assert.equal(screen.present(another.ticket, answer), false);
  assert.equal(root.childNodes.length, 0);
  screen.fail();
  assert.equal(root.childNodes.length, 1);
  screen.clear();
  assert.equal(root.childNodes.length, 0);
});

test('real page mount stays hidden, disabled and clears on auth or navigation', () => {
  const { root, doc, client, events } = fixture();
  assert.equal(
    api.mountDormantPage({ document: doc, client, page: 'story-notes.html' }),
    true
  );
  assert.equal(root.hidden, true);
  const sections = root.childNodes.filter((node) => node.tag === 'section');
  assert.equal(sections.length, 6);
  for (const section of sections) {
    assert.equal(section.childNodes.at(-1).disabled, true);
  }
  const result = root.childNodes.at(-1);
  result.appendChild(doc.createElement('p'));
  events.get('auth')();
  assert.equal(result.childNodes.length, 0);
  assert.equal(root.hidden, true);
  for (const event of [
    'pagehide',
    'pageshow',
    'popstate',
    'visibilitychange'
  ]) {
    result.appendChild(doc.createElement('p'));
    events.get(event)();
    assert.equal(result.childNodes.length, 0);
  }
  assert.equal(
    api.mountDormantPage({ document: doc, client, page: 'story-notes.html' }),
    false
  );
});

test('all ten intended screens have only a hidden review host', async () => {
  const pages = [
    'story-notes.html',
    'episode-edit.html',
    'novel-edit.html',
    'analytics.html',
    'novel.html',
    'search.html',
    'admin-reports.html',
    'admin-trust-safety.html',
    'admin-inquiries.html',
    'admin-analytics.html'
  ];
  for (const page of pages) {
    const html = await readFile(page, 'utf8');
    assert.match(html, /data-novelight-ai-review-host hidden/u);
    assert.match(html, /src="novelight-ai-review-result\.js"/u);
    const caller =
      page === 'analytics.html'
        ? await readFile('novelight-analytics.js', 'utf8')
        : html;
    assert.ok(caller.includes("page:'" + page + "'"));
  }
});

test('all existing placements build typed locked forms without source data', () => {
  const { root, doc, client } = fixture();
  assert.equal(
    api.mountDormantPage({ document: doc, client, page: 'search.html' }),
    true
  );
  const sections = root.childNodes.filter((node) => node.tag === 'section');
  assert.equal(sections.length, 2);
  const controls = sections.flatMap((node) =>
    node.childNodes.flatMap((child) => child.childNodes)
  );
  assert.ok(controls.some((control) => control.tag === 'textarea'));
  assert.ok(controls.some((control) => control.tag === 'select'));
  assert.ok(controls.every((control) => control.disabled === true));
  assert.equal(root.hidden, true);
});
