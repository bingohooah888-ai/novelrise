import assert from 'node:assert/strict';
import test from 'node:test';

import { createOfflineOwnerBibleReviewStateHttpWiring } from '../api/_lib/ai/owner-bible-review-state-offline-wiring.js';
import { createOfflineReadOnlyAuthSessionLookup } from '../api/_lib/ai/owner-private-session-reader.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'synthetic-author-token-not-real';
const ENV = Object.freeze({
  NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_OWNER_REVIEW_STATE_ENABLED: 'true',
  SUPABASE_URL: 'https://staging-example.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic'
});

function reply() {
  return {
    code: 0,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
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

function request(method, actor = OWNER, body) {
  return {
    method,
    query: { novel_id: '17' },
    headers: {
      authorization: 'Bearer ' + TOKEN,
      origin: 'https://offline.example',
      host: 'offline.example',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-novelight-review-state': '1'
    },
    body,
    actor
  };
}

function offlineHarness() {
  let actor = OWNER;
  let allowed = true;
  let row = null;
  let writes = 0;
  let externalCalls = 0;
  const serviceClient = {
    auth: {
      async getUser(token) {
        assert.equal(token, TOKEN);
        return {
          data: { user: { id: actor } },
          error: null
        };
      },
      async getClaims(token) {
        assert.equal(token, TOKEN);
        return {
          data: {
            claims: {
              sub: actor,
              session_id: SESSION,
              role: 'authenticated',
              aud: 'authenticated',
              iat: 900,
              exp: 1100
            }
          },
          error: null
        };
      }
    },
    from(table) {
      let work = 17;
      return {
        select() {
          return this;
        },
        eq(column, value) {
          if (column === 'id' || column === 'novel_id') work = Number(value);
          return this;
        },
        order() {
          return this;
        },
        async limit() {
          if (table !== 'novelight_ai_bible_facts') {
            throw new Error('UNEXPECTED_TABLE');
          }
          return { data: [], error: null };
        },
        async maybeSingle() {
          if (table === 'novels') {
            return {
              data: { id: work, user_id: OWNER },
              error: null
            };
          }
          if (table === 'novelight_ai_owner_review_states') {
            return { data: row, error: null };
          }
          throw new Error('UNEXPECTED_TABLE');
        }
      };
    },
    async rpc(name, args) {
      if (name !== 'novelight_ai_owner_review_state_cas') {
        throw new Error('UNEXPECTED_SERVICE_RPC');
      }
      writes += 1;
      assert.equal(args.p_actor_id, OWNER);
      assert.equal(args.p_novel_id, 17);
      assert.equal(args.p_session_id, SESSION);
      if (row !== null || args.p_expected_revision !== 0) {
        return { data: [], error: null };
      }
      row = {
        actor_id: OWNER,
        novel_id: 17,
        version: 1,
        revision: 1,
        reviewed_ids: args.p_reviewed_ids
      };
      return { data: [row], error: null };
    }
  };
  const handler = createOfflineOwnerBibleReviewStateHttpWiring({
    enabled: true,
    env: ENV,
    serviceClient,
    createAuthorClient: (_url, _key, options) => {
      assert.equal(options.global.headers.Authorization, 'Bearer ' + TOKEN);
      return {
        async rpc(name) {
          if (
            name !== 'novelight_author_character_list' &&
            name !== 'novelight_private_story_notes'
          ) {
            throw new Error('UNEXPECTED_OWNER_RPC');
          }
          externalCalls += 1;
          return { data: [], error: null };
        }
      };
    },
    lookupOneSession: createOfflineReadOnlyAuthSessionLookup({
      queryClient: {
        async query(statement, values) {
          assert.match(statement, /^SELECT EXISTS /u);
          assert.deepEqual(values.length, 2);
          const [sessionId, actorId] = values;
          return {
            command: 'SELECT',
            rowCount: 1,
            rows: [
              {
                active:
                  allowed && sessionId === SESSION && actorId === OWNER
              }
            ]
          };
        }
      }
    }),
    nowEpochSeconds: () => 1000
  });
  return {
    handler,
    get writes() {
      return writes;
    },
    get externalCalls() {
      return externalCalls;
    },
    setActor(next) {
      actor = next;
    },
    revoke() {
      allowed = false;
    }
  };
}

test('unmounted review-state route defaults OFF even with valid capabilities', async () => {
  const route = createOfflineOwnerBibleReviewStateHttpWiring({ env: ENV });
  const res = reply();
  await route(request('GET'), res);
  assert.equal(res.code, 404);
  assert.deepEqual(res.body, { error: 'NOT_FOUND' });
});

// The staging service role cannot read/lock auth.sessions. Do not replace
// an independently trusted private session reader with JWT decoding,
// auth.getUser alone, or a public SECURITY DEFINER shortcut.
test('no server-only session observer means no review-state read or write', async () => {
  let touched = 0;
  const route = createOfflineOwnerBibleReviewStateHttpWiring({
    enabled: true,
    env: ENV,
    serviceClient: {
      auth: {
        getUser() {
          touched += 1;
        },
        getClaims() {
          touched += 1;
        }
      },
      from() {
        touched += 1;
      },
      rpc() {
        touched += 1;
      }
    },
    createAuthorClient() {
      touched += 1;
    },
    nowEpochSeconds() {
      touched += 1;
    }
    // Deliberately no privileged lookupOneSession capability.
  });
  const res = reply();
  await route(
    request('POST', OWNER, { expectedRevision: 0, reviewedIds: [] }),
    res
  );
  assert.equal(res.code, 404);
  assert.equal(touched, 0);
});

test('offline owner HTTP composition reads, commits by CAS and resumes', async () => {
  const h = offlineHarness();
  const before = reply();
  await h.handler(request('GET'), before);
  assert.equal(before.code, 200);
  assert.deepEqual(before.body, {
    version: 1,
    novelId: 17,
    revision: 0,
    reviewedIds: []
  });
  assert.ok(h.externalCalls > 0);

  const saved = reply();
  await h.handler(
    request('POST', OWNER, { expectedRevision: 0, reviewedIds: [] }),
    saved
  );
  assert.equal(saved.code, 200);
  assert.equal(saved.body.revision, 1);
  assert.equal(h.writes, 1);

  const resumed = reply();
  await h.handler(request('GET'), resumed);
  assert.equal(resumed.code, 200);
  assert.equal(resumed.body.revision, 1);

  const conflict = reply();
  await h.handler(
    request('POST', OWNER, { expectedRevision: 0, reviewedIds: [] }),
    conflict
  );
  assert.equal(conflict.code, 409);
  assert.equal(h.writes, 1);
});

test('cross-owner and revoked session cannot read or write review state', async () => {
  const h = offlineHarness();
  h.setActor(OTHER);
  const foreign = reply();
  await h.handler(request('GET'), foreign);
  assert.equal(foreign.code, 404);
  h.setActor(OWNER);
  h.revoke();
  const revoked = reply();
  await h.handler(request('GET'), revoked);
  assert.equal(revoked.code, 503);
  assert.equal(h.writes, 0);
  assert.doesNotMatch(JSON.stringify(revoked.body), /synthetic-author-token/);
});
