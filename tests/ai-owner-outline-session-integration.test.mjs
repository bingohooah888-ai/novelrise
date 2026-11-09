import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import { createOwnerOutlineInternalAdapter } from '../api/_lib/ai/owner-outline-internal-adapter.js';
import { createOfflineOwnerSessionCheck } from '../api/_lib/ai/owner-session-evidence.js';

// Entirely synthetic. Neither this suite nor its dependencies issue requests.
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const OTHER_SESSION = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'offline-integration-only-opaque-test-token';
const NOW = 1800000000;
const CONFIG = {
  id: OWNER,
  url: 'https://mock.supabase.co',
  key: 'sb_publishable_mock_integration_only'
};

function originalRows() {
  return [
    {
      episode_id: 900,
      episode_number: 2,
      episode_title: 'NONPUBLIC_DRAFT_TITLE_NEVER_RETURN',
      episode_status: 'draft',
      chapter_id: 77,
      chapter_title: '序章',
      chapter_position: 1
    },
    {
      episode_id: 40,
      episode_number: 5,
      episode_title: '公開回',
      episode_status: 'published',
      chapter_id: null,
      chapter_title: null,
      chapter_position: null
    }
  ];
}

function harness() {
  const state = {
    events: [],
    claims: {
      sub: OWNER,
      session_id: SESSION,
      role: 'authenticated',
      aud: 'authenticated',
      is_anonymous: false,
      iat: NOW - 30,
      exp: NOW + 90
    },
    session: { id: SESSION, user_id: OWNER },
    actor: OWNER,
    owner: OWNER,
    novelId: 23,
    now: NOW,
    snapshots: [originalRows(), originalRows()],
    verificationError: false,
    sessionError: false,
    authError: false,
    dbError: false,
    rpcError: false,
    throwSensitive: false,
    onRpc: null,
    onSessionLookup: null
  };
  const event = (kind) => state.events.push(kind);
  const count = (kind) => state.events.filter((entry) => entry === kind).length;

  const verifySignedClaims = async (receivedToken) => {
    event('verify');
    assert.equal(receivedToken, TOKEN);
    if (state.throwSensitive) throw new Error('SENSITIVE_' + TOKEN);
    if (state.verificationError) {
      return { error: { message: 'bad signature' }, data: null };
    }
    return { error: null, data: { claims: { ...state.claims } } };
  };

  const readExistingSession = async ({ sessionId, actorId }) => {
    event('session');
    assert.equal(sessionId, state.claims.session_id);
    assert.equal(actorId, OWNER);
    state.onSessionLookup?.(count('session'));
    if (state.throwSensitive) throw new Error('SENSITIVE_' + TOKEN);
    if (state.sessionError) {
      return { data: null, error: { message: 'unavailable' } };
    }
    return { data: state.session ? { ...state.session } : null, error: null };
  };

  const checkSession = createOfflineOwnerSessionCheck({
    verifySignedClaims,
    readExistingSession,
    nowEpochSeconds: () => state.now
  });

  const serviceClient = {
    auth: {
      async getUser(token) {
        event('getUser');
        assert.equal(token, TOKEN);
        if (state.authError) {
          return { data: null, error: { message: 'invalid' } };
        }
        return { data: { user: { id: state.actor } }, error: null };
      }
    },
    from(table) {
      event('novels');
      assert.equal(table, 'novels');
      return {
        select(columns) {
          assert.equal(columns, 'id,user_id');
          return {
            eq(column, id) {
              assert.equal(column, 'id');
              assert.equal(id, 23);
              return {
                async maybeSingle() {
                  if (state.dbError) {
                    return { data: null, error: { message: 'unavailable' } };
                  }
                  return {
                    data: { id: state.novelId, user_id: state.owner },
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
      throw new Error('service role MUST NOT call owner outline RPC');
    }
  };

  const createAuthorClient = (url, key, options) => {
    event('authorClient');
    assert.equal(url, CONFIG.url);
    assert.equal(key, CONFIG.key);
    assert.equal(options.global.headers.Authorization, 'Bearer ' + TOKEN);
    assert.equal(options.auth.persistSession, false);
    return {
      async rpc(name, params) {
        event('rpc');
        assert.equal(name, 'novelight_novel_outline');
        assert.deepEqual(params, { p_novel_id: 23 });
        const number = count('rpc');
        state.onRpc?.(number);
        if (state.throwSensitive) throw new Error('SENSITIVE_' + TOKEN);
        return {
          error: state.rpcError ? { message: 'private RPC' } : null,
          data: state.snapshots[number - 1]
            ? JSON.parse(JSON.stringify(state.snapshots[number - 1]))
            : null
        };
      }
    };
  };
  const adapter = createOwnerOutlineInternalAdapter({
    serviceClient,
    createAuthorClient,
    checkSession,
    config: CONFIG,
    previewEnabled: true
  });
  const preview = () => ({
    novelId: 23,
    aiGenerated: false,
    characters: [],
    notes: [{ type: 'world', title: 'NONPUBLIC_NOTE' }],
    facts: []
  });
  const run = (override = {}) =>
    adapter.read({
      bearer: 'Bearer ' + TOKEN,
      expectedNovelId: 23,
      preview: preview(),
      ...override
    });

  return { state, count, run };
}

test('composed owner JWT observer checks signed session three times before returning private navigation', async () => {
  const f = harness();
  const output = await f.run();
  assert.equal(output?.novelId, 23);
  assert.equal(output.outlineRows.length, 2);
  assert.deepEqual(
    output.outlineRows.map((row) => row.episode_number),
    [5, 2]
  );
  assert.equal(output.outlineRows[1].chapter_title, '序章');
  assert.equal(f.count('getUser'), 2);
  assert.equal(f.count('novels'), 2);
  assert.equal(f.count('verify'), 3);
  assert.equal(f.count('session'), 3);
  assert.equal(f.count('rpc'), 2);
  assert.equal(f.count('authorClient'), 1);
  const json = JSON.stringify(output);
  for (const forbidden of [
    TOKEN,
    'NONPUBLIC_DRAFT_TITLE_NEVER_RETURN',
    'NONPUBLIC_NOTE',
    'episode_status',
    'episode_title'
  ]) {
    assert.equal(json.includes(forbidden), false);
  }
  assert.equal(JSON.stringify(f.state.events).includes(TOKEN), false);
});

test('server-side sign-out before first session check denies the author RPC', async () => {
  const f = harness();
  f.state.session = null;
  assert.equal(await f.run(), null);
  assert.equal(f.count('rpc'), 0);
  assert.equal(f.count('session'), 1);
});

test('server-side logout after the first RPC fails before any second RPC', async () => {
  const f = harness();
  f.state.onRpc = (n) => {
    if (n === 1) f.state.session = null;
  };
  assert.equal(await f.run(), null);
  assert.equal(f.count('rpc'), 1);
  assert.equal(f.count('session'), 2);
});

test('server-side logout after the second RPC clears the private response', async () => {
  const f = harness();
  f.state.onRpc = (n) => {
    if (n === 2) f.state.session = null;
  };
  assert.equal(await f.run(), null);
  assert.equal(f.count('rpc'), 2);
  assert.equal(f.count('session'), 3);
});

test('new valid session ID mid-request is refused instead of cross-session re-binding', async () => {
  const f = harness();
  f.state.onRpc = (n) => {
    if (n !== 1) return;
    f.state.claims.session_id = OTHER_SESSION;
    f.state.session = { id: OTHER_SESSION, user_id: OWNER };
  };
  assert.equal(await f.run(), null);
  assert.equal(f.count('rpc'), 1);
});

test('replaced session row alone cannot be matched to the signed session ID', async () => {
  const f = harness();
  f.state.onRpc = (n) => {
    if (n === 1) f.state.session = { id: OTHER_SESSION, user_id: OWNER };
  };
  assert.equal(await f.run(), null);
  assert.equal(f.count('rpc'), 1);
});

test('signed subject or session owner switching mid-request fails closed', async () => {
  for (const change of [
    (state) => {
      state.claims.sub = OTHER;
    },
    (state) => {
      state.session.user_id = OTHER;
    },
    (state) => {
      state.actor = OTHER;
    },
    (state) => {
      state.owner = OTHER;
    }
  ]) {
    const f = harness();
    f.state.onRpc = (n) => {
      if (n === 2) change(f.state);
    };
    assert.equal(await f.run(), null);
    assert.equal(f.count('rpc'), 2);
  }
});

test('expired JWT during first RPC or final session verification fails closed', async () => {
  for (const afterRpc of [1, 2]) {
    const f = harness();
    f.state.onRpc = (n) => {
      if (n === afterRpc) f.state.now = NOW + 120;
    };
    assert.equal(await f.run(), null);
    assert.equal(f.count('rpc'), afterRpc);
  }
});

test('invalid, anonymous or foreign-owner claims never reach the author RPC', async () => {
  for (const mutate of [
    (s) => {
      s.claims.role = 'anon';
    },
    (s) => {
      s.claims.aud = 'other';
    },
    (s) => {
      s.claims.is_anonymous = true;
    },
    (s) => {
      s.claims.sub = OTHER;
    },
    (s) => {
      s.claims.exp = NOW;
    },
    (s) => {
      s.session.user_id = OTHER;
    },
    (s) => {
      s.owner = OTHER;
    },
    (s) => {
      s.novelId = 999;
    }
  ]) {
    const f = harness();
    mutate(f.state);
    assert.equal(await f.run(), null);
    assert.equal(f.count('rpc'), 0);
  }
});

test('verification, session lookup, auth, novel lookup and RPC errors return null with no secret reporting', async () => {
  for (const change of [
    (s) => {
      s.verificationError = true;
    },
    (s) => {
      s.sessionError = true;
    },
    (s) => {
      s.authError = true;
    },
    (s) => {
      s.dbError = true;
    },
    (s) => {
      s.rpcError = true;
    },
    (s) => {
      s.throwSensitive = true;
    }
  ]) {
    const f = harness();
    change(f.state);
    const response = await f.run();
    assert.equal(response, null);
    assert.equal(JSON.stringify(f.state.events).includes(TOKEN), false);
  }
});

test('draft/publication changes between the two outline RPC reads never return stale data', async () => {
  const f = harness();
  f.state.snapshots[1][0].episode_status = 'published';
  assert.equal(await f.run(), null);
  assert.equal(f.count('rpc'), 2);
});

test('a later request does not reuse an earlier accepted session decision', async () => {
  const f = harness();
  assert.ok(await f.run());
  f.state.session = null;
  assert.equal(await f.run(), null);
  assert.equal(f.count('rpc'), 2);
  assert.equal(f.count('session'), 4);
});

test('the composed test remains offline and the production routes remain disconnected', async () => {
  const [sessionModule, adapterModule, route] = await Promise.all([
    readFile(
      new URL('../api/_lib/ai/owner-session-evidence.js', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL(
        '../api/_lib/ai/owner-outline-internal-adapter.js',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(new URL('../api/ai-owner-novel-bible.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(
    route,
    /owner-session-evidence|owner-outline-internal-adapter/
  );
  assert.doesNotMatch(adapterModule, /from\s+['"]\.\/owner-session-evidence/);
  assert.doesNotMatch(
    sessionModule,
    /from\s+['"]@supabase|\.from\(|\.rpc\(|console\./
  );
});
