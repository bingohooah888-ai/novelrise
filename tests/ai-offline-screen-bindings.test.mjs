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
        attributes: {},
        events: new Map(),
        addEventListener(name, fn) {
          this.events.set(name, fn);
        },
        appendChild(node) {
          this.childNodes.push(node);
        },
        replaceChildren() {
          this.childNodes = [];
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        }
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
  screen.fail('AI_BUDGET_DENIED');
  assert.match(root.childNodes[0].textContent, /利用上限/u);
  screen.fail('private token or provider diagnostic');
  assert.doesNotMatch(root.childNodes[0].textContent, /private token/u);
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

test('analysis plan gating and privacy review remain fail closed', () => {
  const { doc } = fixture();
  const free = doc.createElement('section');
  const denied = api.buildSelectionForm(
    free,
    'analytics-copilot',
    { plan: 'free' },
    false
  );
  assert.equal(denied.read(), null);
  assert.equal(free.childNodes.at(-2).disabled, true);
  const admin = doc.createElement('section');
  const missing = api.buildSelectionForm(admin, 'inquiry-assistant', {}, false);
  assert.equal(missing.read(), null);
  assert.equal(admin.childNodes.at(-1).disabled, true);
});

test('work choices are isolated and invalidation purges the previous scope', () => {
  const { root } = fixture();
  const form = api.buildSelectionForm(
    root,
    'writing-assistant',
    {
      novels: [
        { id: '1', label: '架空作品1' },
        { id: '2', label: '架空作品2' }
      ],
      episodes: [
        { id: '11', label: '第1話', novelId: '1' },
        { id: '21', label: '別作品', novelId: '2' }
      ]
    },
    false
  );
  const fields = root.childNodes.flatMap((row) => row.childNodes);
  const fieldName = (row) => row.attributes['data-ai-field'];
  const work = fields.find((row) => fieldName(row) === 'novelId');
  const episode = fields.find((row) => fieldName(row) === 'episodeIds');
  work.value = '1';
  work.events.get('change')();
  assert.deepEqual(episode.childNodes.map((row) => row.value), ['11']);
  episode.selectedOptions = episode.childNodes;
  assert.deepEqual(plain(form.read()), { novelId: '1', episodeIds: ['11'] });
  work.value = '2';
  work.events.get('change')();
  assert.deepEqual(episode.childNodes.map((row) => row.value), ['21']);
  assert.equal(form.read(), null);
  episode.selectedOptions = episode.childNodes;
  assert.deepEqual(plain(form.read()), { novelId: '2', episodeIds: ['21'] });
  form.invalidate();
  assert.equal(form.read(), null);
  assert.equal(episode.childNodes.length, 0);
  assert.equal(work.childNodes.length, 0);
});

test('locked catalog is never inspected; search reuses only public choices', () => {
  const { root, doc, client, events } = fixture();
  const inaccessible = new Proxy(
    {},
    {
      get() {
        throw new Error('private catalog must never be read');
      }
    }
  );
  const section = doc.createElement('section');
  assert.ok(api.buildSelectionForm(section, 'work-analysis', inaccessible));
  assert.equal(
    api.mountDormantPage({
      document: doc,
      client,
      page: 'search.html',
      publicChoices: {
        genres: [{ id: 'その他', label: 'その他' }],
        tags: [{ id: 'adventure', label: '冒険' }]
      }
    }),
    true
  );
  const first = root.childNodes[1];
  const fields = first.childNodes.flatMap((row) => row.childNodes);
  const tags = fields.find((x) => x.attributes['data-ai-field'] === 'tagIds');
  assert.deepEqual(tags.childNodes.map((row) => row.value), ['adventure']);
  assert.equal(tags.disabled, true);
  events.get('auth')();
  assert.equal(tags.childNodes.length, 0);
  assert.equal(root.hidden, true);
});

test('temporary scoped choices formatter diagnostic', async () => {
  const { format, resolveConfig } = await import('prettier');
  const path = 'tests/ai-offline-screen-bindings.test.mjs';
  const full = await readFile(path, 'utf8');
  const marker = "\ntest('temporary scoped choices formatter diagnostic'";
  const index = full.indexOf(marker);
  assert.ok(index >= 0);
  const source = full.slice(0, index);
  const config = await resolveConfig(path);
  const formatted = await format(source, { ...config, filepath: path });
  const original = source.split('\n');
  const expected = formatted.split('\n');
  let start = 0;
  while (start < original.length && original[start] === expected[start]) {
    start++;
  }
  let end = 0;
  while (
    end < original.length - start &&
    end < expected.length - start &&
    original[original.length - 1 - end] ===
      expected[expected.length - 1 - end]
  ) {
    end++;
  }
  const diff = {
    path,
    start,
    remove: original.length - start - end,
    insert: expected.slice(start, expected.length - end)
  };
  process.stdout.write(
    'AI_SCOPED_FORMAT_DIAGNOSTIC ' + JSON.stringify(diff) + '\n'
  );
});
