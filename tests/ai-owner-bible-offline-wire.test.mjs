import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { URL } from 'node:url';

import { createOfflineOwnerBibleOutlineWiring } from '../api/_lib/ai/owner-bible-outline-offline-wiring.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'synthetic-only-no-live-jwt';
const NOW = 1800000000;
const ENV = {
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_OWNER_OUTLINE_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
  SUPABASE_URL: 'https://mock.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_wire_test'
};

const OUTLINE = [
  {
    episode_id: 100,
    episode_number: 3,
    episode_title: 'PRIVATE_UNPUBLISHED_TITLE',
    episode_status: 'draft',
    chapter_id: 8,
    chapter_title: '第一章',
    chapter_position: 1
  }
];

function reply() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}
function request(overrides = {}) {
  return {
    method: 'GET',
    headers: {
      host: 'novelight.test',
      origin: 'https://novelight.test',
      'sec-fetch-site': 'same-origin',
      authorization: 'Bearer ' + TOKEN
    },
    query: { novel_id: '14' },
    ...overrides
  };
}

function harness() {
  const state = {
    calls: [],
    actor: OWNER,
    workOwner: OWNER,
    activeSession: true,
    signedSubject: OWNER,
    failGetClaims: false,
    failPreview: false,
    onRpc: null
  };
  const record = (name) => state.calls.push(name);
  const serviceClient = {
    auth: {
      async getUser(token) {
        record('getUser');
        assert.equal(token, TOKEN);
        return { data: { user: { id: state.actor } }, error: null };
      },
      async getClaims(token) {
        record('getClaims');
        assert.equal(token, TOKEN);
        return state.failGetClaims
          ? { data: null, error: { message: 'synthetic denial' } }
          : {
              data: {
                claims: {
                  sub: state.signedSubject,
                  session_id: SESSION,
                  role: 'authenticated',
                  aud: 'authenticated',
                  iat: NOW - 20,
                  exp: NOW + 300,
                  is_anonymous: false
                }
              },
              error: null
            };
      }
    },
    from(table) {
      record('from:' + table);
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        order() {
          return q;
        },
        async maybeSingle() {
          return {
            data: { id: 14, user_id: state.workOwner },
            error: null
          };
        },
        async limit() {
          return { data: [], error: null };
        }
      };
      return q;
    },
    rpc() {
      throw Error('service-role RPC must never return private facts');
    }
  };
  const createAuthorClient = (url, key, options) => {
    record('authorClient');
    assert.equal(url, ENV.SUPABASE_URL);
    assert.equal(key, ENV.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(options.global.headers.Authorization, 'Bearer ' + TOKEN);
    return {
      async rpc(name, args) {
        record('rpc:' + name);
        if (name === 'novelight_novel_outline') {
          assert.deepEqual(args, { p_novel_id: 14 });
          state.onRpc?.();
          return { data: OUTLINE.map((row) => ({ ...row })), error: null };
        }
        if (state.failPreview) return { data: null, error: { code: '42501' } };
        if (name === 'novelight_author_character_list')
          return {
            data: [{ id: 5, name: '主人公', aliases: [] }],
            error: null
          };
        if (name === 'novelight_private_story_notes')
          return {
            data: [
              {
                id: 7,
                note_type: 'plot',
                character_id: null,
                title: 'PRIVATE_NOTES_TITLE',
                body: 'SECRET_PRIVATE_STORY_DETAIL'
              }
            ],
            error: null
          };
        throw Error('Unexpected author RPC: ' + name);
      }
    };
  };
  const capabilities = {
    serviceClient,
    createAuthorClient,
    async lookupOneSession({ sessionId, actorId }) {
      record('session');
      assert.equal(sessionId, SESSION);
      assert.equal(actorId, OWNER);
      return state.activeSession;
    },
    nowEpochSeconds() {
      return NOW;
    }
  };
  async function run(
    { enabled = true, env = ENV, ...overrides } = {},
    req = request()
  ) {
    const handler = createOfflineOwnerBibleOutlineWiring({
      ...capabilities,
      enabled,
      env,
      ...overrides
    });
    const res = reply();
    await handler(req, res);
    return res;
  }
  return { run, state, capabilities };
}

test('default-off wiring is 404 before any preview, claims or session IO', async () => {
  const f = harness();
  for (const config of [
    { enabled: false },
    { env: { ...ENV, NOVELIGHT_AI_OWNER_OUTLINE_ENABLED: 'false' } },
    { env: { ...ENV, NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'false' } }
  ]) {
    const res = await f.run(config);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'NOT_FOUND' });
    assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  }
  assert.deepEqual(f.state.calls, []);
});

test('existing preview reader plus signed/session/navigation capabilities return only outline', async () => {
  const f = harness();
  const res = await f.run();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    novelId: 14,
    aiGenerated: false,
    outlineRows: [
      {
        episode_id: 100,
        episode_number: 3,
        chapter_id: 8,
        chapter_title: '第一章',
        chapter_position: 1
      }
    ]
  });
  assert.equal(f.state.calls.filter((name) => name === 'getClaims').length, 3);
  assert.equal(f.state.calls.filter((name) => name === 'session').length, 3);
  assert.equal(
    f.state.calls.filter((name) => name === 'rpc:novelight_novel_outline')
      .length,
    2
  );
  assert.equal(
    f.state.calls.filter((name) => name === 'rpc:novelight_private_story_notes')
      .length,
    1
  );
  assert.doesNotMatch(
    JSON.stringify(res),
    /SECRET_PRIVATE_STORY_DETAIL|PRIVATE_UNPUBLISHED_TITLE|PRIVATE_NOTES_TITLE|synthetic-only-no-live-jwt/
  );
});

test('missing signed-verification or privileged-session capability cannot read private data', async () => {
  for (const disabled of ['getClaims', 'lookupOneSession', 'nowEpochSeconds']) {
    const f = harness();
    if (disabled === 'getClaims')
      f.capabilities.serviceClient.auth.getClaims = undefined;
    const res = await f.run(
      disabled === 'getClaims' ? {} : { [disabled]: undefined }
    );
    assert.notEqual(res.statusCode, 200);
    assert.doesNotMatch(
      JSON.stringify(res.body),
      /SECRET_PRIVATE|PRIVATE_UNPUBLISHED/
    );
  }
});

test('foreign actor, invalid signature, revoked session, preview failure are fail closed', async () => {
  for (const mode of [
    'foreign',
    'signed',
    'revoked',
    'previewFailure',
    'revokedDuringRead'
  ]) {
    const f = harness();
    if (mode === 'foreign') f.state.workOwner = OTHER;
    if (mode === 'signed') f.state.failGetClaims = true;
    if (mode === 'revoked') f.state.activeSession = false;
    if (mode === 'previewFailure') f.state.failPreview = true;
    if (mode === 'revokedDuringRead') {
      f.state.onRpc = () => {
        f.state.activeSession = false;
      };
    }
    const res = await f.run();
    assert.notEqual(res.statusCode, 200, mode);
    assert.doesNotMatch(
      JSON.stringify(res.body),
      /SECRET_PRIVATE|PRIVATE_UNPUBLISHED|synthetic-only/
    );
  }
});

test('wrong method, work, origin and bearer are rejected before privileged reads', async () => {
  const f = harness();
  for (const [req, code] of [
    [request({ method: 'POST' }), 405],
    [request({ query: { novel_id: '0' } }), 400],
    [
      request({
        headers: { ...request().headers, origin: 'https://evil.test' }
      }),
      403
    ],
    [
      request({
        headers: { ...request().headers, authorization: 'Bearer short' }
      }),
      401
    ]
  ]) {
    const res = await f.run({}, req);
    assert.equal(res.statusCode, code);
  }
  assert.deepEqual(f.state.calls, []);
});

test('offline wiring has no live route, and preview/studio/offline modules remain unmounted', () => {
  const paths = [
    '../api/ai-owner-novel-bible.js',
    '../story-notes.html',
    '../novelight-ai-bible-owner-studio.js'
  ];
  for (const path of paths) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /owner-bible-outline-offline-wiring|owner-outline-offline-http/
    );
  }
});

test('full offline journey: owner studio -> preview -> HTTP reader -> existing server wiring -> chapter -> logout', async () => {
  await import('../novelight-ai-bible-author-workspace.js');
  await import('../novelight-ai-bible-owner-outline.js');
  await import('../novelight-ai-bible-owner-panel.js');
  await import('../novelight-ai-bible-owner-studio.js');
  await import('../novelight-ai-bible-owner-outline-offline-http.js');
  const f = harness();

  class Node {
    constructor(tag, doc) {
      this.tagName = tag.toUpperCase();
      this.ownerDocument = doc;
      this.children = [];
      this.attributes = {};
      this.listeners = new Map();
      this.hidden = false;
      this._text = '';
      this.removed = false;
    }
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }
    get textContent() {
      return (
        this._text + this.children.map((child) => child.textContent).join('')
      );
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    addEventListener(name, handler) {
      this.listeners.set(name, handler);
    }
    remove() {
      this.removed = true;
    }
  }
  const doc = {
    createElement(tag) {
      return new Node(tag, doc);
    },
    getElementById(id) {
      assert.equal(id, 'main-content');
      return main;
    }
  };
  const main = new Node('main', doc);
  const find = (root, className) => {
    if (root.className === className) return root;
    for (const child of root.children) {
      const found = find(child, className);
      if (found) return found;
    }
    return null;
  };
  let session = { user: { id: OWNER }, access_token: TOKEN };
  let listener = null;
  const client = {
    auth: {
      async getSession() {
        return { data: { session }, error: null };
      },
      onAuthStateChange(callback) {
        listener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      }
    }
  };
  const preview = {
    novelId: 14,
    aiGenerated: false,
    characters: [],
    notes: [],
    facts: [
      {
        kind: 'foreshadowing',
        key: '隠された扉',
        confirmed: [
          {
            sourceEpisodeId: 100,
            payload: { summary: 'PRIVATE_OWNER_FACT', evidence: '' }
          }
        ],
        suggestions: []
      }
    ]
  };
  const outlineTransport = async (url, opts) => {
    assert.equal(url, '/api/ai-owner-bible-outline?novel_id=14');
    assert.equal(opts.method, 'GET');
    assert.equal(opts.credentials, 'same-origin');
    assert.equal(opts.cache, 'no-store');
    assert.equal(opts.headers.Authorization, 'Bearer ' + TOKEN);
    const response = await f.run({}, request());
    return {
      ok: response.statusCode === 200,
      async json() {
        return response.body;
      }
    };
  };
  const offlineReadOutline =
    globalThis.NovelightAiBibleOwnerOutlineOfflineHttp.createReader({
      enabled: true,
      client,
      fetcher: outlineTransport
    });
  let browserPreviewReads = 0;
  const fetcher = async (url, options) => {
    assert.equal(url, '/api/ai-owner-novel-bible?novel_id=14');
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    browserPreviewReads += 1;
    return {
      ok: true,
      async json() {
        return preview;
      }
    };
  };
  const mounted = await globalThis.NovelightAiBibleOwnerStudio.attach({
    client,
    novelId: '14',
    ownerId: OWNER,
    doc,
    fetcher,
    readOutline: offlineReadOutline
  });
  assert.equal(mounted, true);
  assert.equal(browserPreviewReads, 1);
  const chapter = find(main, 'novelight-ai-workspace-chapter-filter');
  const episode = find(main, 'novelight-ai-workspace-episode-filter');
  assert.ok(chapter);
  assert.ok(episode);
  assert.equal(chapter.children[1].value, '8');
  chapter.value = '8';
  chapter.listeners.get('change')();
  episode.value = '100';
  episode.listeners.get('change')();
  const article = find(main, 'novelight-ai-workspace-item');
  assert.equal(article.hidden, false);
  assert.match(article.textContent, /PRIVATE_OWNER_FACT/);
  assert.match(main.textContent, /第一章／第3話/);
  assert.equal(f.state.calls.filter((name) => name === 'session').length, 3);

  // Revoking the privileged session prevents a second server read, clears
  // previous private DOM text and does not retain the chapter selection.
  f.state.activeSession = false;
  const reload = find(main, 'novelight-ai-bible-reload');
  reload.listeners.get('click')();
  await delay(0);
  assert.doesNotMatch(main.textContent, /PRIVATE_OWNER_FACT/);
  assert.match(main.textContent, /読み込みに失敗しました/);

  session = null;
  listener?.('SIGNED_OUT', null);
  assert.equal(main.textContent, '');
});
