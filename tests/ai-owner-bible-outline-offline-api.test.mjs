import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import { createOfflineOwnerBibleOutlineApiHandler } from '../api/_lib/ai/owner-bible-outline-offline-api.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'synthetic-offline-only-not-a-real-jwt';
const NOW = 1800000000;
const CONFIG = {
  id: OWNER,
  url: 'https://mock.supabase.co',
  key: 'sb_publishable_synthetic_outline_api'
};
const ENV = {
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_OWNER_OUTLINE_ENABLED: 'true'
};
const OUTLINE = [
  {
    episode_id: 9,
    episode_number: 2,
    episode_title: 'PRIVATE_DRAFT_EPISODE_TITLE',
    episode_status: 'draft',
    chapter_id: 2,
    chapter_title: '第一章',
    chapter_position: 1
  }
];

function response() {
  return {
    headers: {},
    code: null,
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function request(options = {}) {
  return {
    method: 'GET',
    headers: {
      host: 'novelight.test',
      origin: 'https://novelight.test',
      'sec-fetch-site': 'same-origin',
      authorization: 'Bearer ' + TOKEN
    },
    query: { novel_id: '23' },
    ...options
  };
}

function harness() {
  const state = {
    calls: [],
    preview: {
      novelId: 23,
      aiGenerated: false,
      characters: [],
      notes: [],
      facts: []
    },
    owner: OWNER,
    workOwner: OWNER,
    allowedSession: true,
    invalidRpc: false,
    onRpc: null,
    failPreview: false
  };
  const mark = (value) => state.calls.push(value);
  const serviceClient = {
    auth: {
      async getUser(token) {
        mark('getUser');
        assert.equal(token, TOKEN);
        return { data: { user: { id: state.owner } }, error: null };
      }
    },
    from(name) {
      mark('ownerLookup');
      assert.equal(name, 'novels');
      return {
        select(fields) {
          assert.equal(fields, 'id,user_id');
          return {
            eq(field, value) {
              assert.equal(field, 'id');
              assert.equal(value, 23);
              return {
                async maybeSingle() {
                  return {
                    data: { id: 23, user_id: state.workOwner },
                    error: null
                  };
                }
              };
            }
          };
        }
      };
    },
    rpc() {
      throw Error('service client cannot run the private outline RPC');
    }
  };
  const dependencies = {
    env: ENV,
    enabled: true,
    serviceClient,
    config: CONFIG,
    async readOwnerPreview() {
      mark('preview');
      if (state.failPreview) throw Error('SECRET_PRIVATE_PREVIEW_ERROR');
      return state.preview;
    },
    createAuthorClient(url, key, options) {
      mark('authorClient');
      assert.equal(url, CONFIG.url);
      assert.equal(key, CONFIG.key);
      assert.equal(options.global.headers.Authorization, 'Bearer ' + TOKEN);
      return {
        async rpc(name, args) {
          mark('authorRpc');
          assert.equal(name, 'novelight_novel_outline');
          assert.deepEqual(args, { p_novel_id: 23 });
          state.onRpc?.();
          return {
            data: state.invalidRpc
              ? [{ ...OUTLINE[0], episode_id: 1 }, { ...OUTLINE[0] }]
              : OUTLINE,
            error: null
          };
        }
      };
    },
    async verifySignedClaims(received) {
      mark('verifySigned');
      assert.equal(received, TOKEN);
      return {
        data: {
          claims: {
            sub: OWNER,
            session_id: SESSION,
            role: 'authenticated',
            aud: 'authenticated',
            iat: NOW - 50,
            exp: NOW + 300,
            is_anonymous: false
          }
        },
        error: null
      };
    },
    async lookupOneSession({ sessionId, actorId }) {
      mark('sessionExists');
      assert.equal(sessionId, SESSION);
      assert.equal(actorId, OWNER);
      return state.allowedSession;
    },
    nowEpochSeconds() {
      return NOW;
    }
  };
  const createHandler = (overrides = {}) =>
    createOfflineOwnerBibleOutlineApiHandler({ ...dependencies, ...overrides });

  return { state, createHandler };
}

test('default-off handler returns 404 before touching privileged capabilities', async () => {
  const f = harness();
  for (const overrides of [
    { enabled: false },
    { env: {} },
    { env: { NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true' } },
    { env: { NOVELIGHT_AI_OWNER_OUTLINE_ENABLED: 'true' } }
  ]) {
    const res = response();
    await f.createHandler(overrides)(request(), res);
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { error: 'NOT_FOUND' });
    assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
    assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
  }
  assert.deepEqual(f.state.calls, []);
});

test('valid synthetic owner GET yields only the scoped chapter navigation', async () => {
  const f = harness();
  const res = response();
  await f.createHandler()(request(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, {
    novelId: 23,
    aiGenerated: false,
    outlineRows: [
      {
        episode_id: 9,
        episode_number: 2,
        chapter_id: 2,
        chapter_title: '第一章',
        chapter_position: 1
      }
    ]
  });
  assert.equal(f.state.calls.filter((x) => x === 'preview').length, 1);
  assert.equal(f.state.calls.filter((x) => x === 'authorRpc').length, 2);
  assert.equal(f.state.calls.filter((x) => x === 'verifySigned').length, 3);
  assert.equal(f.state.calls.filter((x) => x === 'sessionExists').length, 3);
  assert.doesNotMatch(
    JSON.stringify(res.body),
    /DRAFT_EPISODE_TITLE|draft|jwt/i
  );
});

test('method, origin, bearer and work scope are rejected before source access', async () => {
  const cases = [
    [request({ method: 'POST' }), 405],
    [
      request({
        headers: { ...request().headers, origin: 'https://evil.test' }
      }),
      403
    ],
    [
      request({
        headers: { ...request().headers, 'sec-fetch-site': 'cross-site' }
      }),
      403
    ],
    [
      request({
        headers: { ...request().headers, authorization: 'Bearer short' }
      }),
      401
    ],
    [request({ headers: { ...request().headers, authorization: '' } }), 401],
    [request({ query: { novel_id: '0' } }), 400],
    [request({ query: { novel_id: '23other' } }), 400],
    [request({ query: { novel_id: ['23', '24'] } }), 400]
  ];
  for (const [req, code] of cases) {
    const f = harness();
    const res = response();
    await f.createHandler()(req, res);
    assert.equal(res.code, code);
    assert.deepEqual(f.state.calls, []);
  }
});

test('HTTP-supplied preview and outline data are ignored entirely', async () => {
  const f = harness();
  const req = request({
    body: {
      preview: { novelId: 24, aiGenerated: false },
      outlineRows: [{ episode_id: 999999, episode_number: 1 }]
    },
    query: {
      novel_id: '23',
      preview: { novelId: 24, aiGenerated: false },
      outlineRows: [{ episode_id: 999999, episode_number: 1 }]
    }
  });
  const res = response();
  await f.createHandler()(req, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.outlineRows[0].episode_id, 9);
  assert.equal(res.body.novelId, 23);
});

test('cross-work preview, foreign owner and missing trusted services fail closed', async () => {
  for (const scenario of [
    'preview',
    'owner',
    'missingPreview',
    'missingSession'
  ]) {
    const f = harness();
    const options = {};
    if (scenario === 'preview')
      f.state.preview = { ...f.state.preview, novelId: 24 };
    if (scenario === 'owner') f.state.workOwner = OTHER;
    if (scenario === 'missingPreview') options.readOwnerPreview = undefined;
    if (scenario === 'missingSession') options.lookupOneSession = undefined;
    const res = response();
    await f.createHandler(options)(request(), res);
    assert.notEqual(res.code, 200);
    assert.doesNotMatch(
      JSON.stringify(res.body),
      /PRIVATE_|session_id|auth.sessions/
    );
    if (scenario === 'preview') {
      assert.equal(f.state.calls.filter((x) => x === 'authorRpc').length, 0);
    }
  }
});

test('revoke session during RPC or inconsistent outline returns no private rows', async () => {
  for (const mode of ['revoke', 'inconsistent']) {
    const f = harness();
    if (mode === 'revoke') {
      f.state.onRpc = () => {
        f.state.allowedSession = false;
      };
    } else {
      f.state.invalidRpc = true;
    }
    const res = response();
    await f.createHandler()(request(), res);
    assert.equal(res.code, 404);
    assert.deepEqual(res.body, { error: 'NOT_FOUND' });
  }
});

test('server exceptions are sanitized and an untrusted preview cannot leak', async () => {
  const f = harness();
  f.state.failPreview = true;
  const res = response();
  await f.createHandler()(request(), res);
  assert.equal(res.code, 503);
  assert.deepEqual(res.body, { error: 'OUTLINE_UNAVAILABLE' });
  assert.doesNotMatch(JSON.stringify(res.body), /SECRET_|PRIVATE_|jwt/);
});

test('no public API or author page imports the offline handler', () => {
  const paths = [
    '../api/ai-owner-novel-bible.js',
    '../novelight-ai-bible-owner-studio.js',
    '../story-notes.html'
  ];
  for (const path of paths) {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /owner-bible-outline-offline-api/);
  }
  const page = readFileSync(
    new URL('../story-notes.html', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(page, /readOutline\\s*:/);
});
