import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import { createOfflinePrivateSessionReader } from '../api/_lib/ai/owner-private-session-reader.js';
import { createOfflineOwnerBibleNavigation } from '../api/_lib/ai/owner-bible-offline-navigation.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const SESSION_B = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'synthetic-only-not-a-jwt-for-production';
const NOW = 1800000000;
const CONFIG = {
  id: OWNER,
  url: 'https://mock.supabase.co',
  key: 'sb_publishable_offline_private_session_test'
};

function sessionReaderHarness() {
  let result = true;
  const calls = [];
  const read = createOfflinePrivateSessionReader({
    async lookupOneSession(args) {
      calls.push(args);
      if (result === 'throw') throw Error('SECRET_TOKEN_SHOULD_NOT_LEAK');
      return result;
    }
  });
  return { read, calls, set(value) { result = value; } };
}

test('Boolean true means a single owner+session attestation, not an auth.sessions row', async () => {
  const f = sessionReaderHarness();
  const value = await f.read({ sessionId: SESSION.toUpperCase(), actorId: OWNER.toUpperCase() });
  assert.deepEqual(value, {
    data: { id: SESSION, user_id: OWNER },
    error: null
  });
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.data), true);
  assert.deepEqual(f.calls, [{ sessionId: SESSION, actorId: OWNER }]);
});

test('fail closed for every non-boolean truthy response and lookup errors', async () => {
  const f = sessionReaderHarness();
  for (const value of [
    false, null, undefined, 1, 'true', { exists: true },
    { data: { id: SESSION, user_id: OWNER } }, 'throw'
  ]) {
    f.set(value);
    assert.equal(await f.read({ sessionId: SESSION, actorId: OWNER }), null);
  }
  assert.equal(f.calls.length, 8);
});

test('never call a privileged session capability for malformed IDs or missing dependency', async () => {
  const f = sessionReaderHarness();
  for (const params of [
    {}, { actorId: OWNER },
    { actorId: OWNER, sessionId: 'missing' },
    { actorId: 'another-user', sessionId: SESSION },
    { actorId: OWNER, sessionId: SESSION + 'extra' },
    { actorId: '', sessionId: SESSION }
  ]) {
    assert.equal(await f.read(params), null);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(
    await createOfflinePrivateSessionReader()({ actorId: OWNER, sessionId: SESSION }),
    null
  );
});

test('attestation has no cache; a revoked or rotated session fails on subsequent reads', async () => {
  const f = sessionReaderHarness();
  assert.ok(await f.read({ actorId: OWNER, sessionId: SESSION }));
  f.set(false);
  assert.equal(await f.read({ actorId: OWNER, sessionId: SESSION }), null);
  assert.equal(f.calls.length, 2);
});

function harness() {
  const state = {
    calls: [],
    currentSession: SESSION,
    actor: OWNER,
    novelOwner: OWNER,
    currentNovel: 23,
    exp: NOW + 300,
    now: NOW,
    lookups: true,
    signedSubject: OWNER,
    onLookup: null,
    onRpc: null,
    failLookup: false,
    failGetUser: false,
    failNovel: false,
    failRpc: false,
    first: [
      {
        episode_id: 99, episode_number: 2,
        episode_title: 'PRIVATE_DRAFT_TITLE',
        episode_status: 'draft',
        chapter_id: 9, chapter_title: '章A', chapter_position: 1
      },
      {
        episode_id: 40, episode_number: 1,
        episode_title: '第1話',
        episode_status: 'published',
        chapter_id: null, chapter_title: null, chapter_position: null
      }
    ],
    second: null
  };
  state.second = JSON.parse(JSON.stringify(state.first));
  const push = (name) => state.calls.push(name);
  const count = (name) => state.calls.filter((x) => x === name).length;
  const serviceClient = {
    auth: {
      async getUser(received) {
        push('auth');
        assert.equal(received, TOKEN);
        return state.failGetUser
          ? { error: { message: 'synthetic auth failure' }, data: null }
          : { error: null, data: { user: { id: state.actor } } };
      }
    },
    from(name) {
      push('novel');
      assert.equal(name, 'novels');
      return {
        select(fields) {
          assert.equal(fields, 'id,user_id');
          return {
            eq(col, work) {
              assert.equal(col, 'id');
              assert.equal(work, 23);
              return {
                async maybeSingle() {
                  return state.failNovel
                    ? { error: { message: 'synthetic lookup failure' }, data: null }
                    : { error: null, data: { id: state.currentNovel, user_id: state.novelOwner } };
                }
              };
            }
          };
        }
      };
    },
    rpc() {
      throw Error('unscoped service role RPC must never be used');
    }
  };
  const createAuthorClient = (url, key, options) => {
    push('client');
    assert.equal(url, CONFIG.url);
    assert.equal(key, CONFIG.key);
    assert.equal(options.global.headers.Authorization, 'Bearer ' + TOKEN);
    return {
      async rpc(name, parameters) {
        push('rpc');
        assert.equal(name, 'novelight_novel_outline');
        assert.deepEqual(parameters, { p_novel_id: 23 });
        const step = count('rpc');
        state.onRpc?.(step);
        return {
          error: state.failRpc ? { message: 'PRIVATE_ERROR_TOKEN' } : null,
          data: JSON.parse(JSON.stringify(step === 1 ? state.first : state.second))
        };
      }
    };
  };
  const verifySignedClaims = async (token) => {
    push('signed');
    assert.equal(token, TOKEN);
    return {
      error: null,
      data: {
        claims: {
          sub: state.signedSubject,
          session_id: state.currentSession,
          role: 'authenticated',
          aud: 'authenticated',
          iat: NOW - 20,
          exp: state.exp,
          is_anonymous: false
        }
      }
    };
  };
  const lookupOneSession = async ({ sessionId, actorId }) => {
    push('exist');
    assert.equal(actorId, OWNER);
    state.onLookup?.(count('exist'));
    if (state.failLookup) throw Error('PRIVATE_LOOKUP_ERROR');
    return state.lookups === true &&
      sessionId === state.currentSession &&
      state.currentSession !== null;
  };
  const navigator = createOfflineOwnerBibleNavigation({
    serviceClient,
    createAuthorClient,
    verifySignedClaims,
    lookupOneSession,
    nowEpochSeconds: () => state.now,
    config: CONFIG,
    previewEnabled: true
  });
  const preview = () => ({
    novelId: 23, aiGenerated: false,
    characters: [], notes: [{ title: 'PRIVATE_AUTHOR_NOTE' }], facts: []
  });
  const read = (overrides = {}) =>
    navigator.read({
      bearer: 'Bearer ' + TOKEN,
      expectedNovelId: 23,
      preview: preview(),
      ...overrides
    });
  return { state, count, read };
}

test('all existing contracts compose: owner verified, two outline reads, 3 singleton session lookups', async () => {
  const f = harness();
  const result = await f.read();
  assert.ok(result);
  assert.deepEqual(result.outlineRows.map((r) => r.episode_number), [1, 2]);
  assert.equal(result.outlineRows[1].chapter_title, '章A');
  assert.equal(f.count('auth'), 2);
  assert.equal(f.count('novel'), 2);
  assert.equal(f.count('client'), 1);
  assert.equal(f.count('rpc'), 2);
  assert.equal(f.count('signed'), 3);
  assert.equal(f.count('exist'), 3);
  const text = JSON.stringify(result);
  for (const secret of [
    TOKEN, 'PRIVATE_DRAFT_TITLE', 'PRIVATE_AUTHOR_NOTE', 'episode_status',
    'episode_title', 'session_id', SESSION, 'access_token'
  ]) {
    assert.equal(text.includes(secret), false);
  }
});

test('missing server capabilities or disabled owner preview fail without RPC', async () => {
  const f = harness();
  const privateDisabled = createOfflineOwnerBibleNavigation({ previewEnabled: false });
  assert.equal(await privateDisabled.read({
    bearer: 'Bearer ' + TOKEN, expectedNovelId: 23, preview: {
      novelId: 23, aiGenerated: false, characters: [], notes: [], facts: []
    }
  }), null);
  assert.equal(await f.read({ bearer: 'Bearer no' }), null);
  assert.equal(await f.read({ expectedNovelId: 24 }), null);
  assert.equal(f.count('auth'), 0);
});

test('logout between RPCs stops before the second RPC and suppresses private data', async () => {
  const f = harness();
  f.state.onRpc = (step) => {
    if (step === 1) f.state.lookups = false;
  };
  assert.equal(await f.read(), null);
  assert.equal(f.count('rpc'), 1);
  assert.equal(f.count('exist'), 2);
});

test('logout after final RPC stops before return, without leaking draft navigation', async () => {
  const f = harness();
  f.state.onRpc = (step) => {
    if (step === 2) f.state.lookups = false;
  };
  assert.equal(await f.read(), null);
  assert.equal(f.count('rpc'), 2);
  assert.equal(f.count('exist'), 3);
});

test('session rotation mid-request rejects old binding even when new session exists', async () => {
  const f = harness();
  f.state.onRpc = (step) => {
    if (step === 1) f.state.currentSession = SESSION_B;
  };
  assert.equal(await f.read(), null);
  assert.equal(f.count('rpc'), 1);
});

test('anonymous/foreign JWT, wrong novel ownership or expired JWT are rejected', async () => {
  for (const patch of [
    (s) => { s.signedSubject = OTHER; },
    (s) => { s.novelOwner = OTHER; },
    (s) => { s.currentNovel = 24; },
    (s) => { s.exp = NOW; },
    (s) => { s.failGetUser = true; },
    (s) => { s.failNovel = true; }
  ]) {
    const f = harness();
    patch(f.state);
    assert.equal(await f.read(), null);
    assert.equal(f.count('rpc'), 0);
  }
});

test('changed draft publishing state, unexpected metadata or missing lookup fail closed', async () => {
  const changed = harness();
  changed.state.second[0].episode_status = 'published';
  assert.equal(await changed.read(), null);
  const error = harness();
  error.state.failLookup = true;
  assert.equal(await error.read(), null);
  assert.equal(error.count('rpc'), 0);
  const rpcError = harness();
  rpcError.state.failRpc = true;
  assert.equal(await rpcError.read(), null);
});

test('private capability never returns row fields or accepts a truthy object attestation', async () => {
  const reader = createOfflinePrivateSessionReader({
    async lookupOneSession() { return { exists: true }; }
  });
  assert.equal(await reader({ sessionId: SESSION, actorId: OWNER }), null);
  const f = harness();
  const report = await f.read();
  assert.equal(Object.hasOwn(report, 'claims'), false);
  assert.equal(Object.hasOwn(report, 'ownerId'), false);
});

test('browser and production entrypoint do not import these unapproved offline modules', async () => {
  const [reader, composition, route] = await Promise.all([
    readFile(new URL('../api/_lib/ai/owner-private-session-reader.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_lib/ai/owner-bible-offline-navigation.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/ai-owner-novel-bible.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(reader, /process\.env|createClient|\.rpc\s*\(|\.from\s*\(|console\./);
  assert.doesNotMatch(composition, /process\.env|createClient|\.rpc\s*\(|\.from\s*\(|console\./);
  assert.doesNotMatch(route, /owner-private-session-reader|owner-bible-offline-navigation/);
});
