import assert from 'node:assert/strict';
import test from 'node:test';

import '../novelight-ai-bible-author-workspace.js';
import '../novelight-ai-bible-owner-outline.js';
import '../novelight-ai-bible-owner-panel.js';

const { createOfflineReader } = globalThis.NovelightAiBibleOwnerPanel;

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this._textContent = '';
    this.listeners = new Map();
    this.attributes = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return (
      this._textContent +
      this.children.map((child) => child.textContent).join('')
    );
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(event, listener) {
    this.listeners.set(event, listener);
  }
}

const doc = {
  createElement(tagName) {
    return new FakeElement(tagName, doc);
  }
};

function target() {
  const node = new FakeElement('div', doc);
  node.textContent = 'OLD_PRIVATE_OWNER_CONTENT';
  return node;
}

function find(root, className) {
  if (root.className === className) return root;
  for (const child of root.children) {
    const found = find(child, className);
    if (found) return found;
  }
  return null;
}

function preview({
  novelId = 17,
  secret = 'AUTHOR_PRIVATE_NOTE',
  empty = false
} = {}) {
  return {
    novelId,
    aiGenerated: false,
    characters: empty ? [] : [{ name: '凛', aliases: [] }],
    notes: empty ? [] : [{ title: '第一幕', body: secret, type: 'plot' }],
    facts: empty
      ? []
      : [
          {
            kind: 'event',
            key: '出発',
            confirmed: [
              {
                sourceEpisodeId: 100,
                payload: { summary: '朝の旅立ち', evidence: '' }
              }
            ],
            suggestions: []
          }
        ]
  };
}

const outline = [
  {
    episode_id: 100,
    episode_number: 3,
    episode_title: '出発',
    episode_status: 'published',
    chapter_id: null,
    chapter_title: null,
    chapter_position: null
  }
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('offline reader links the existing owner preview and outline contracts to the UI', async () => {
  const host = target();
  const calls = [];
  const reader = createOfflineReader({
    target: host,
    novelId: 17,
    readPreview: async ({ novelId }) => {
      calls.push(['preview', novelId]);
      return preview();
    },
    readOutline: async ({ novelId, preview: payload }) => {
      calls.push(['outline', novelId, payload.novelId]);
      return outline;
    }
  });
  assert.ok(reader);
  assert.equal(host.textContent.includes('OLD_PRIVATE_OWNER_CONTENT'), false);
  assert.deepEqual(calls, []);
  assert.match(host.textContent, /まだ読み込まれていません/);
  assert.equal(await reader.reload(), true);
  assert.deepEqual(calls, [
    ['preview', 17],
    ['outline', 17, 17]
  ]);
  assert.match(host.textContent, /第3話／参照エピソードID：100/);
  assert.match(host.textContent, /AUTHOR_PRIVATE_NOTE/);
  assert.match(host.textContent, /作品カルテを読み込みました/);
  assert.equal(find(host, 'novelight-ai-bible-reload').textContent, '再読込');
});

test('empty authorized preview shows an explicit empty state without AI activity', async () => {
  const host = target();
  const reader = createOfflineReader({
    target: host,
    novelId: '17',
    readPreview: async () => preview({ empty: true })
  });
  assert.equal(await reader.reload(), true);
  assert.match(host.textContent, /登録情報はまだありません/);
  assert.match(host.textContent, /登録情報はありません/);
  assert.equal(find(host, 'novelight-ai-bible-private-content').hidden, false);
  assert.equal(find(host, 'novelight-ai-bible-reload').disabled, false);
});

test('reload button fetches fresh synthetic data and clears the previous owner view', async () => {
  const host = target();
  let count = 0;
  const reader = createOfflineReader({
    target: host,
    novelId: 17,
    readPreview: async () =>
      preview({
        secret: ++count === 1 ? 'PRIVATE_VERSION_ONE' : 'PRIVATE_VERSION_TWO'
      })
  });
  assert.equal(await reader.reload(), true);
  assert.match(host.textContent, /PRIVATE_VERSION_ONE/);
  const button = find(host, 'novelight-ai-bible-reload');
  button.listeners.get('click')();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(count, 2);
  assert.doesNotMatch(host.textContent, /PRIVATE_VERSION_ONE/);
  assert.match(host.textContent, /PRIVATE_VERSION_TWO/);
});

test('failed reload clears previous private content and never renders error secrets', async () => {
  const host = target();
  let count = 0;
  const reader = createOfflineReader({
    target: host,
    novelId: 17,
    readPreview: async () => {
      if (++count === 1) return preview({ secret: 'PREVIOUS_OWNER_PRIVATE' });
      throw new Error('DO_NOT_EXPOSE_JWT_PRIVATE_ERROR');
    }
  });
  assert.equal(await reader.reload(), true);
  assert.match(host.textContent, /PREVIOUS_OWNER_PRIVATE/);
  assert.equal(await reader.reload(), false);
  assert.doesNotMatch(
    host.textContent,
    /PREVIOUS_OWNER_PRIVATE|DO_NOT_EXPOSE_JWT/
  );
  assert.match(host.textContent, /読み込みに失敗しました。再読込してください/);
  assert.equal(find(host, 'novelight-ai-bible-private-content').hidden, true);
  assert.equal(find(host, 'novelight-ai-bible-reload').disabled, false);
});

test('wrong-work and review-list responses fail closed after previous success', async () => {
  const cases = [
    preview({ novelId: 18 }),
    { novelId: 17, aiGenerated: false, candidates: [] },
    {
      ...preview(),
      facts: [
        { kind: 'event', key: '出発', confirmed: [null], suggestions: [] }
      ]
    }
  ];
  for (const invalid of cases) {
    const host = target();
    let reads = 0;
    const reader = createOfflineReader({
      target: host,
      novelId: 17,
      readPreview: async () =>
        reads++ === 0 ? preview({ secret: 'PRIVATE_BEFORE_RELOAD' }) : invalid
    });
    assert.equal(await reader.reload(), true);
    assert.equal(await reader.reload(), false);
    assert.doesNotMatch(host.textContent, /PRIVATE_BEFORE_RELOAD/);
    assert.match(host.textContent, /読み込みに失敗しました/);
  }
});

test('invalid or failed owner outline cannot silently fall back to ID-only data', async () => {
  for (const readOutline of [
    async () => [{ ...outline[0], episode_id: 999 }],
    async () => null,
    async () => {
      throw new Error('PRIVATE_RPC_ERROR');
    }
  ]) {
    const host = target();
    const reader = createOfflineReader({
      target: host,
      novelId: 17,
      readPreview: async () => preview({ secret: 'PRIVATE_OUTLINE_NOTE' }),
      readOutline
    });
    assert.equal(await reader.reload(), false);
    assert.doesNotMatch(
      host.textContent,
      /PRIVATE_OUTLINE_NOTE|PRIVATE_RPC_ERROR/
    );
    assert.equal(find(host, 'novelight-ai-bible-private-content').hidden, true);
  }
});

test('a slower earlier reload can never overwrite the latest owner view', async () => {
  const first = deferred();
  let calls = 0;
  const host = target();
  const reader = createOfflineReader({
    target: host,
    novelId: 17,
    readPreview: () =>
      ++calls === 1
        ? first.promise
        : Promise.resolve(preview({ secret: 'LATEST_PRIVATE_VIEW' }))
  });
  const pending = reader.reload();
  assert.equal(find(host, 'novelight-ai-bible-reload').disabled, true);
  assert.equal(await reader.reload(), true);
  first.resolve(preview({ secret: 'STALE_PRIVATE_VIEW' }));
  assert.equal(await pending, false);
  assert.match(host.textContent, /LATEST_PRIVATE_VIEW/);
  assert.doesNotMatch(host.textContent, /STALE_PRIVATE_VIEW/);
  assert.equal(find(host, 'novelight-ai-bible-reload').disabled, false);
});

test('disposing mid-read clears private content and ignores the late response', async () => {
  const response = deferred();
  const host = target();
  const reader = createOfflineReader({
    target: host,
    novelId: 17,
    readPreview: () => response.promise
  });
  const pending = reader.reload();
  reader.dispose();
  response.resolve(preview({ secret: 'IN_FLIGHT_SECRET' }));
  assert.equal(await pending, false);
  assert.equal(await reader.reload(), false);
  assert.equal(host.hidden, true);
  assert.equal(host.textContent, '');
});

test('invalid parameters cannot start an offline preview read', async () => {
  for (const options of [
    { novelId: 0, readPreview: async () => preview() },
    { novelId: 17, readPreview: null },
    { novelId: 17, readPreview: async () => preview(), readOutline: true }
  ]) {
    const host = target();
    assert.equal(createOfflineReader({ target: host, ...options }), null);
    assert.equal(host.hidden, true);
    assert.equal(host.textContent, '');
  }
});
