import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import '../novelight-ai-bible-author-workspace.js';
import '../novelight-ai-bible-owner-panel.js';
import '../novelight-ai-bible-owner-studio.js';
import '../novelight-ai-bible-owner-review-state-offline-http.js';

import { createOfflineOwnerBibleReviewStateWorkflow } from '../api/_lib/ai/owner-bible-review-state-offline.js';
import { createOfflineOwnerBibleReviewStateApiHandler } from '../api/_lib/ai/owner-bible-review-state-offline-api.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-owner-access-token-only';
const ENV = {
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_OWNER_REVIEW_STATE_ENABLED: 'true'
};
const { localReviewSummary } = globalThis.NovelightAiBibleAuthorWorkspace;
const { createOfflineReader: createBrowserAdapter } =
  globalThis.NovelightAiBibleReviewStateOfflineHttp;
const { attach } = globalThis.NovelightAiBibleOwnerStudio;

function preview(novelId = 17) {
  return {
    novelId,
    aiGenerated: false,
    characters: [
      { name: '凛', aliases: ['青い鍵'] },
      { name: '蒼', aliases: ['青い鍵'] }
    ],
    notes: [{ type: 'plot', title: '第一幕', body: 'AUTHOR_PRIVATE_NOTE' }],
    facts: [
      {
        kind: 'event',
        key: '旅立ち',
        confirmed: [
          {
            sourceEpisodeId: 100,
            payload: { summary: '春の朝', evidence: '' }
          }
        ],
        suggestions: [
          {
            sourceEpisodeId: 100,
            payload: { summary: '夏の夜', evidence: '玄関の描写' }
          }
        ]
      }
    ]
  };
}

function fixture(options = {}) {
  const calls = { auth: 0, novel: 0, preview: 0, reads: 0, cas: 0 };
  const records = new Map();
  let actor = OWNER;
  let workOwner = OWNER;
  let revoked = false;
  let unexpectedSave = null;
  let authoritativePreview = preview();
  const key = (a, n) => a + ':' + n;
  const authClient = {
    auth: {
      async getUser(token) {
        calls.auth += 1;
        assert.equal(token, TOKEN);
        return revoked
          ? { error: { code: 'revoked' }, data: null }
          : { data: { user: { id: actor } }, error: null };
      }
    }
  };
  const serviceClient = {
    from(table) {
      assert.equal(table, 'novels');
      return {
        select(selection) {
          assert.equal(selection, 'id,user_id');
          return {
            eq(column, id) {
              assert.equal(column, 'id');
              calls.novel += 1;
              return {
                async maybeSingle() {
                  return {
                    data: { id, user_id: workOwner },
                    error: null
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  const repository = {
    async readSnapshot({ actorId, novelId }) {
      calls.reads += 1;
      const row = records.get(key(actorId, novelId));
      return row ? { ...row, reviewedIds: [...row.reviewedIds] } : null;
    },
    async compareAndSwap({ actorId, novelId, expectedRevision, reviewedIds }) {
      calls.cas += 1;
      if (unexpectedSave) return unexpectedSave;
      // This check and update are synchronous before the first await,
      // modelling ONE transactional compare-and-swap DB operation.
      const scope = key(actorId, novelId);
      const last = records.get(scope);
      const rev = last?.revision ?? 0;
      if (rev !== expectedRevision) return null;
      const next = {
        version: 1,
        actorId,
        novelId,
        revision: rev + 1,
        reviewedIds: [...reviewedIds]
      };
      records.set(scope, next);
      return { ...next, reviewedIds: [...next.reviewedIds] };
    }
  };
  const readOwnerPreview = async ({ actorId, novelId }) => {
    calls.preview += 1;
    assert.equal(actorId, OWNER);
    assert.equal(novelId, 17);
    return authoritativePreview;
  };
  const config = {
    enabled: true,
    ownerId: OWNER,
    authClient,
    serviceClient,
    readOwnerPreview,
    repository,
    ...options
  };
  return {
    calls,
    records,
    config,
    get ids() {
      return localReviewSummary(authoritativePreview).checks.map((c) => c.id);
    },
    setActor: (value) => {
      actor = value;
    },
    setWorkOwner: (value) => {
      workOwner = value;
    },
    revoke: () => {
      revoked = true;
    },
    setPreview: (value) => {
      authoritativePreview = value;
    },
    setBadSave: (value) => {
      unexpectedSave = value;
    },
    workflow() {
      return createOfflineOwnerBibleReviewStateWorkflow(config);
    }
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

const baseHeaders = {
  authorization: 'Bearer ' + TOKEN,
  host: 'novelight.jp',
  'sec-fetch-site': 'same-origin',
  origin: 'https://novelight.jp',
  'content-type': 'application/json',
  'x-novelight-review-state': '1'
};

function makeApi(f) {
  const handler = createOfflineOwnerBibleReviewStateApiHandler({
    enabled: true,
    env: ENV,
    ...f.config
  });
  const request = async (method = 'GET', change = null, adjustments = {}) => {
    const res = response();
    await handler(
      {
        method,
        headers: { ...baseHeaders, ...adjustments.headers },
        query: { novel_id: '17', ...adjustments.query },
        ...(change !== null ? { body: change } : {})
      },
      res
    );
    return res;
  };
  return { handler, request };
}

test('offline workflow defaults to disabled even with injected auth/repository', async () => {
  const f = fixture();
  const workflow = createOfflineOwnerBibleReviewStateWorkflow({
    ...f.config,
    enabled: false
  });
  await assert.rejects(
    workflow.read({ token: TOKEN, novelId: 17 }),
    /AI_OWNER_REVIEW_STATE_DISABLED/
  );
  assert.deepEqual(f.calls, {
    auth: 0,
    novel: 0,
    preview: 0,
    reads: 0,
    cas: 0
  });
});

test('authenticated server read returns only owner-scoped opaque IDs, not notes or JWTs', async () => {
  const f = fixture();
  const state = await f.workflow().read({ token: TOKEN, novelId: 17 });
  assert.deepEqual(state, {
    version: 1,
    novelId: 17,
    revision: 0,
    reviewedIds: []
  });
  assert.equal(f.calls.auth, 1);
  assert.equal(f.calls.novel, 1);
  assert.equal(f.calls.preview, 1);
  assert.doesNotMatch(
    JSON.stringify(state),
    /AUTHOR_PRIVATE_NOTE|synthetic-owner-access/
  );
});

test('atomic scoped CAS saves and resumes review IDs without promoting AI candidates', async () => {
  const f = fixture();
  const original = JSON.stringify(preview());
  const id = f.ids[0];
  const saved = await f.workflow().save({
    token: TOKEN,
    novelId: 17,
    expectedRevision: 0,
    reviewedIds: [id],
    explicitAuthorAction: true
  });
  assert.deepEqual(saved, {
    version: 1,
    novelId: 17,
    revision: 1,
    reviewedIds: [id]
  });
  assert.equal(f.calls.cas, 1);
  const resumed = await f.workflow().read({ token: TOKEN, novelId: 17 });
  assert.deepEqual(resumed, saved);
  assert.equal(JSON.stringify(preview()), original);
});

test('two writers on the same revision cannot both commit', async () => {
  const f = fixture();
  const id = f.ids[0];
  const workflow = f.workflow();
  const result = await Promise.allSettled(
    [id, f.ids[1]].map((key) =>
      workflow.save({
        token: TOKEN,
        novelId: 17,
        expectedRevision: 0,
        reviewedIds: [key],
        explicitAuthorAction: true
      })
    )
  );
  assert.equal(result.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(result.filter((x) => x.status === 'rejected').length, 1);
  assert.match(
    result.find((x) => x.status === 'rejected').reason.message,
    /AI_OWNER_REVIEW_STATE_CONFLICT/
  );
  assert.equal(f.records.size, 1);
  assert.equal(
    (await workflow.read({ token: TOKEN, novelId: 17 })).revision,
    1
  );
});

test('wrong actor, wrong work owner, revoked identity and invalid client action fail closed', async () => {
  const f = fixture();
  const workflow = f.workflow();
  f.setActor(OTHER);
  await assert.rejects(
    workflow.read({ token: TOKEN, novelId: 17 }),
    /AI_OWNER_REVIEW_STATE_DENIED/
  );
  f.setActor(OWNER);
  f.setWorkOwner(OTHER);
  await assert.rejects(
    workflow.read({ token: TOKEN, novelId: 17 }),
    /AI_OWNER_REVIEW_STATE_DENIED/
  );
  f.setWorkOwner(OWNER);
  for (const args of [
    {
      reviewedIds: [f.ids[0]],
      expectedRevision: 0,
      explicitAuthorAction: false
    },
    {
      reviewedIds: [f.ids[0], f.ids[0]],
      expectedRevision: 0,
      explicitAuthorAction: true
    },
    {
      reviewedIds: ['rv1-0000000000000000'],
      expectedRevision: 0,
      explicitAuthorAction: true
    },
    {
      reviewedIds: [f.ids[0]],
      expectedRevision: -1,
      explicitAuthorAction: true
    }
  ]) {
    await assert.rejects(
      workflow.save({ token: TOKEN, novelId: 17, ...args }),
      /AI_OWNER_REVIEW_STATE_(?:DENIED|STALE)/
    );
  }
  f.revoke();
  await assert.rejects(
    workflow.read({ token: TOKEN, novelId: 17 }),
    /AI_OWNER_REVIEW_STATE_DENIED/
  );
  assert.equal(f.calls.cas, 0);
});

test('server recomputes valid checklist from the current private author preview', async () => {
  const f = fixture();
  const [oldId, stillId] = f.ids;
  await f.workflow().save({
    token: TOKEN,
    novelId: 17,
    expectedRevision: 0,
    reviewedIds: [oldId, stillId],
    explicitAuthorAction: true
  });
  const updated = preview();
  updated.characters[1].aliases = ['別名変更'];
  f.setPreview(updated);
  const read = await f.workflow().read({ token: TOKEN, novelId: 17 });
  assert.equal(read.revision, 1);
  assert.deepEqual(read.reviewedIds, [stillId]);
  await assert.rejects(
    f.workflow().save({
      token: TOKEN,
      novelId: 17,
      expectedRevision: 1,
      reviewedIds: [oldId],
      explicitAuthorAction: true
    }),
    /AI_OWNER_REVIEW_STATE_STALE/
  );
  assert.equal(f.calls.cas, 1);
});

test('cross-owner rows and invalid CAS receipts cannot become successful saves', async () => {
  const f = fixture();
  f.records.set(OWNER + ':17', {
    version: 1,
    novelId: 17,
    actorId: OTHER,
    revision: 3,
    reviewedIds: []
  });
  await assert.rejects(
    f.workflow().read({ token: TOKEN, novelId: 17 }),
    /AI_OWNER_REVIEW_STATE_UNAVAILABLE/
  );
  f.records.clear();
  f.setBadSave({
    version: 1,
    novelId: 17,
    actorId: OWNER,
    revision: 500,
    reviewedIds: []
  });
  await assert.rejects(
    f.workflow().save({
      token: TOKEN,
      novelId: 17,
      expectedRevision: 0,
      reviewedIds: [f.ids[0]],
      explicitAuthorAction: true
    }),
    /AI_OWNER_REVIEW_STATE_UNAVAILABLE/
  );
});

test('HTTP factory stays 404 and does not touch privileged readers by default', async () => {
  const f = fixture();
  const handler = createOfflineOwnerBibleReviewStateApiHandler({
    ...f.config,
    env: ENV,
    enabled: false
  });
  const res = response();
  await handler(
    {
      method: 'GET',
      headers: baseHeaders,
      query: { novel_id: '17' }
    },
    res
  );
  assert.equal(res.statusCode, 404);
  assert.deepEqual(f.calls, {
    auth: 0,
    novel: 0,
    preview: 0,
    reads: 0,
    cas: 0
  });
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
});

test('HTTP GET, POST, 409 conflict and reload expose only the scoped snapshot', async () => {
  const f = fixture();
  const { request } = makeApi(f);
  const first = await request();
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.reviewedIds, []);
  const change = { expectedRevision: 0, reviewedIds: [f.ids[0]] };
  const saved = await request('POST', change);
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.revision, 1);
  const conflict = await request('POST', change);
  assert.equal(conflict.statusCode, 409);
  assert.deepEqual(conflict.body, { error: 'REVIEW_STATE_CONFLICT' });
  const resumed = await request();
  assert.equal(resumed.statusCode, 200);
  assert.deepEqual(resumed.body, saved.body);
  assert.doesNotMatch(
    JSON.stringify(saved.body),
    /AUTHOR_PRIVATE_NOTE|synthetic-owner-access|春の朝/
  );
});

test('HTTP rejects forbidden POSTs, extra fields, foreign works and bad IDs before persistence', async () => {
  const f = fixture();
  const { request } = makeApi(f);
  for (const [method, body, changes, code] of [
    ['DELETE', null, {}, 405],
    ['GET', null, { headers: { 'sec-fetch-site': 'cross-site' } }, 403],
    ['GET', null, { headers: { authorization: undefined } }, 401],
    ['GET', null, { query: { novel_id: 'abc' } }, 400],
    [
      'POST',
      { expectedRevision: 0, reviewedIds: [] },
      { headers: { 'x-novelight-review-state': undefined } },
      403
    ],
    ['POST', { expectedRevision: 0, reviewedIds: [], ownerId: OWNER }, {}, 400],
    ['POST', { expectedRevision: 0, reviewedIds: ['bad'] }, {}, 400],
    [
      'POST',
      { expectedRevision: 0, reviewedIds: [] },
      { headers: { 'content-type': 'text/plain' } },
      400
    ]
  ]) {
    const res = await request(method, body, changes);
    assert.equal(res.statusCode, code);
  }
  assert.equal(f.calls.cas, 0);
});

test('HTTP denied owner and stale private settings cannot be used to write', async () => {
  const f = fixture();
  const { request } = makeApi(f);
  f.setActor(OTHER);
  const foreign = await request();
  assert.equal(foreign.statusCode, 404);
  f.setActor(OWNER);
  const stale = await request('POST', {
    expectedRevision: 0,
    reviewedIds: ['rv1-0000000000000000']
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(f.calls.cas, 0);
});

test('browser adapter refuses missing capabilities, wrong works and changed sessions', async () => {
  let session = { user: { id: OWNER }, access_token: TOKEN };
  let calls = 0;
  const client = {
    auth: {
      async getSession() {
        return { data: { session }, error: null };
      }
    }
  };
  const reader = createBrowserAdapter({
    enabled: true,
    client,
    ownerId: OWNER,
    novelId: 17,
    fetcher: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          version: 1,
          novelId: 17,
          revision: 0,
          reviewedIds: []
        })
      };
    }
  });
  assert.equal(
    createBrowserAdapter({ client, ownerId: OWNER, novelId: 17 }),
    null
  );
  assert.ok(reader);
  await assert.rejects(reader.read({ novelId: 18 }), /REVIEW_WORK_MISMATCH/);
  assert.equal(calls, 0);
  assert.equal((await reader.read({ novelId: 17 })).revision, 0);
  session = {
    user: { id: OTHER },
    access_token: 'other-token-must-not-be-used'
  };
  await assert.rejects(reader.read({ novelId: 17 }), /REVIEW_SESSION_CHANGED/);
  assert.equal(calls, 1);
});

test('browser adapter sends same-origin bearer transport and handles conflicts', async () => {
  const f = fixture();
  const { handler } = makeApi(f);
  const client = {
    auth: {
      async getSession() {
        return {
          data: {
            session: {
              user: { id: OWNER },
              access_token: TOKEN
            }
          },
          error: null
        };
      }
    }
  };
  const browser = createBrowserAdapter({
    enabled: true,
    client,
    novelId: 17,
    ownerId: OWNER,
    fetcher: async (url, options) => {
      assert.equal(url, '/api/ai-owner-bible-review-state?novel_id=17');
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
      const headers = Object.fromEntries(
        Object.entries(options.headers).map(([key, value]) => [
          key.toLowerCase(),
          value
        ])
      );
      const res = response();
      await handler(
        {
          method: options.method,
          query: { novel_id: '17' },
          headers: {
            ...headers,
            host: 'novelight.jp',
            origin: 'https://novelight.jp',
            'sec-fetch-site': 'same-origin'
          },
          ...(options.body ? { body: JSON.parse(options.body) } : {})
        },
        res
      );
      return {
        ok: res.statusCode === 200,
        status: res.statusCode,
        json: async () => res.body
      };
    }
  });
  assert.equal((await browser.read({ novelId: 17 })).revision, 0);
  const saved = await browser.save({
    novelId: 17,
    expectedRevision: 0,
    reviewedIds: [f.ids[0]]
  });
  assert.equal(saved.revision, 1);
  await assert.rejects(
    browser.save({ novelId: 17, expectedRevision: 0, reviewedIds: [f.ids[1]] }),
    /REVIEW_STATE_CONFLICT/
  );
  assert.equal((await browser.read({ novelId: 17 })).revision, 1);
});

class FakeElement {
  constructor(tagName, doc) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this._text = '';
    this.hidden = false;
    this.disabled = false;
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  appendChild(node) {
    this.children.push(node);
    return node;
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  addEventListener(key, listener) {
    this.listeners.set(key, listener);
  }
  remove() {
    this.removed = true;
  }
}

function findClass(root, name) {
  if (root.className === name) return root;
  for (const child of root.children) {
    const found = findClass(child, name);
    if (found) return found;
  }
  return null;
}

test('complete offline author journey persists confirmation and resumes after reload', async () => {
  const f = fixture();
  const { handler } = makeApi(f);
  const authSession = { user: { id: OWNER }, access_token: TOKEN };
  let subscriber;
  const client = {
    auth: {
      async getSession() {
        return { data: { session: authSession }, error: null };
      },
      onAuthStateChange(listener) {
        subscriber = listener;
        return { data: { subscription: { unsubscribe() {} } } };
      }
    }
  };
  const reviewTransport = createBrowserAdapter({
    enabled: true,
    client,
    novelId: 17,
    ownerId: OWNER,
    fetcher: async (_url, options) => {
      const res = response();
      const headers = Object.fromEntries(
        Object.entries(options.headers).map(([key, value]) => [
          key.toLowerCase(),
          value
        ])
      );
      await handler(
        {
          method: options.method,
          query: { novel_id: '17' },
          headers: {
            ...headers,
            host: 'novelight.jp',
            origin: 'https://novelight.jp',
            'sec-fetch-site': 'same-origin'
          },
          ...(options.body ? { body: JSON.parse(options.body) } : {})
        },
        res
      );
      return {
        ok: res.statusCode === 200,
        status: res.statusCode,
        json: async () => res.body
      };
    }
  });

  async function openStudio() {
    const main = new FakeElement('main', null);
    const doc = {
      getElementById(id) {
        assert.equal(id, 'main-content');
        return main;
      },
      createElement(tagName) {
        return new FakeElement(tagName, doc);
      }
    };
    const allowed = await attach({
      client,
      novelId: 17,
      ownerId: OWNER,
      doc,
      fetcher: async () => ({
        ok: true,
        json: async () => preview()
      }),
      readReviewState: reviewTransport.read,
      saveReviewState: reviewTransport.save
    });
    assert.equal(allowed, true);
    return main;
  }

  const first = await openStudio();
  const button = findClass(first, 'novelight-ai-workspace-reviewed-button');
  assert.ok(button);
  await button.listeners.get('click')();
  assert.match(first.textContent, /保存済みの確認済み：1\/2件/);
  assert.match(first.textContent, /確認状態を保存しました/);

  const reopened = await openStudio();
  assert.match(reopened.textContent, /保存済みの確認済み：1\/2件/);
  assert.match(reopened.textContent, /AUTHOR_PRIVATE_NOTE/);
  assert.equal(f.calls.cas, 1);
  subscriber?.('SIGNED_OUT', null);
  assert.equal(reopened.children[0].removed, true);
  assert.equal(reopened.children[0].children[0].textContent, '');
});

test('new review-state API and browser adapter are not mounted in production', () => {
  const html = readFileSync(
    new URL('../story-notes.html', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(
    html,
    /novelight-ai-bible-owner-review-state-offline-http/
  );
  assert.equal(
    existsSync(
      new URL('../api/ai-owner-bible-review-state.js', import.meta.url)
    ),
    false
  );
});

test('revocation after private preview but before CAS prevents a write', async () => {
  const f = fixture();
  const workflow = createOfflineOwnerBibleReviewStateWorkflow({
    ...f.config,
    async readOwnerPreview() {
      f.revoke();
      return preview();
    }
  });
  await assert.rejects(
    workflow.save({
      token: TOKEN,
      novelId: 17,
      expectedRevision: 0,
      reviewedIds: [f.ids[0]],
      explicitAuthorAction: true
    }),
    /AI_OWNER_REVIEW_STATE_DENIED/
  );
  assert.equal(f.calls.cas, 0);
});

test('wrong owner for a second work never reaches snapshot storage', async () => {
  const f = fixture();
  const workflow = f.workflow();
  f.setWorkOwner(OTHER);
  await assert.rejects(
    workflow.read({ token: TOKEN, novelId: 18 }),
    /AI_OWNER_REVIEW_STATE_DENIED/
  );
  assert.equal(f.calls.reads, 0);
  assert.equal(f.calls.cas, 0);
});
