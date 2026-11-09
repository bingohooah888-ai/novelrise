import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import { createOwnerOutlineInternalAdapter } from '../api/_lib/ai/owner-outline-internal-adapter.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-no-real-jwt-token-only';
const BEARER = 'Bearer ' + TOKEN;
const CONFIG = {
  id: OWNER,
  url: 'https://mock.supabase.co',
  key: 'sb_publishable_synthetic_test_key_only'
};

function rows() {
  return [
    {
      episode_id: 901,
      episode_number: 2,
      episode_title: '秘密の草稿',
      episode_status: 'draft',
      chapter_id: 15,
      chapter_title: '序章',
      chapter_position: 1
    },
    {
      episode_id: 50,
      episode_number: 5,
      episode_title: '公開作品',
      episode_status: 'published',
      chapter_id: null,
      chapter_title: null,
      chapter_position: null
    }
  ];
}

function preview() {
  return {
    novelId: 23,
    aiGenerated: false,
    characters: [],
    notes: [],
    facts: []
  };
}

function fixture() {
  const state = {
    calls: [],
    actor: OWNER,
    novelOwner: OWNER,
    novelId: 23,
    active: true,
    binding: 'opaque-session-A',
    rpcData: [rows(), rows()],
    authError: false,
    dbError: false,
    rpcError: false,
    throwOnRpc: false,
    afterFirstRpc: null,
    afterSecondRpc: null
  };
  const serviceClient = {
    auth: {
      async getUser(received) {
        state.calls.push({
          action: 'getUser',
          matchesBearer: received === TOKEN
        });
        if (state.authError)
          return { error: { message: 'unavailable' }, data: {} };
        return { error: null, data: { user: { id: state.actor } } };
      }
    },
    from(table) {
      state.calls.push({ action: 'from', table });
      assert.equal(table, 'novels');
      return {
        select(columns) {
          assert.equal(columns, 'id,user_id');
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              assert.equal(value, 23);
              return {
                async maybeSingle() {
                  if (state.dbError)
                    return { error: { message: 'hidden' }, data: null };
                  return {
                    error: null,
                    data: {
                      id: state.novelId,
                      user_id: state.novelOwner
                    }
                  };
                }
              };
            }
          };
        }
      };
    },
    rpc() {
      throw new Error('never use elevated/service client for author RPC');
    }
  };
  function createAuthorClient(url, key, options) {
    state.calls.push({
      action: 'createAuthor',
      correctUrl: url === CONFIG.url,
      correctKey: key === CONFIG.key,
      correctHeader: options.global.headers.Authorization === BEARER,
      persistSession: options.auth.persistSession
    });
    return {
      async rpc(name, args) {
        state.calls.push({ action: 'authorRpc', name, args });
        if (state.throwOnRpc)
          throw new Error('private draft - never surface this');
        const number =
          state.calls.filter((call) => call.action === 'authorRpc').length - 1;
        if (number === 0) state.afterFirstRpc?.();
        if (number === 1) state.afterSecondRpc?.();
        return {
          error: state.rpcError ? { message: 'private failure' } : null,
          data: structuredClone(state.rpcData[number])
        };
      }
    };
  }
  async function checkSession({ bearerToken, actorId, novelId }) {
    state.calls.push({
      action: 'checkSession',
      correctToken: bearerToken === TOKEN,
      correctActor: actorId === OWNER,
      novelId
    });
    return { active: state.active, binding: state.binding };
  }
  return {
    state,
    serviceClient,
    createAuthorClient,
    checkSession,
    adapter(extra = {}) {
      return createOwnerOutlineInternalAdapter({
        serviceClient,
        createAuthorClient,
        config: CONFIG,
        checkSession,
        previewEnabled: true,
        ...extra
      });
    },
    async run(extra = {}) {
      return this.adapter().read({
        bearer: BEARER,
        expectedNovelId: 23,
        preview: preview(),
        ...extra
      });
    }
  };
}

function count(state, action) {
  return state.calls.filter((call) => call.action === action).length;
}

test('owner-only synthetic token author RPC returns navigation fields without draft titles', async () => {
  const f = fixture();
  const response = await f.run();
  assert.equal(response?.novelId, 23);
  assert.deepEqual(
    response.outlineRows.map((row) => row.episode_number),
    [5, 2]
  );
  assert.equal(response.outlineRows[1].chapter_title, '序章');
  assert.equal(Object.hasOwn(response.outlineRows[1], 'episode_title'), false);
  assert.equal(Object.hasOwn(response.outlineRows[1], 'episode_status'), false);
  assert.equal(Object.hasOwn(response, 'token'), false);
  assert.equal(count(f.state, 'getUser'), 2);
  assert.equal(count(f.state, 'from'), 2);
  assert.equal(count(f.state, 'checkSession'), 3);
  assert.equal(count(f.state, 'authorRpc'), 2);
  assert.deepEqual(
    f.state.calls
      .filter((entry) => entry.action === 'authorRpc')
      .map((entry) => [entry.name, entry.args.p_novel_id]),
    [
      ['novelight_novel_outline', 23],
      ['novelight_novel_outline', 23]
    ]
  );
  assert.deepEqual(
    f.state.calls
      .filter((entry) => entry.action === 'createAuthor')
      .map((entry) => [
        entry.correctUrl,
        entry.correctKey,
        entry.correctHeader,
        entry.persistSession
      ]),
    [[true, true, true, false]]
  );
});

test('disabled, missing provider config and missing mandatory session check make no requests', async () => {
  for (const altered of [
    { previewEnabled: false },
    { config: null },
    { config: { ...CONFIG, id: OTHER } },
    { config: { ...CONFIG, url: 'http://mock.supabase.co' } },
    { config: { ...CONFIG, key: 'secret' } },
    { checkSession: null },
    { createAuthorClient: null }
  ]) {
    const f = fixture();
    const response = await f.adapter(altered).read({
      bearer: BEARER,
      expectedNovelId: 23,
      preview: preview()
    });
    // A different valid configured owner still needs verified auth,
    // but must not reach the author RPC.
    assert.equal(response, null);
    assert.equal(count(f.state, 'authorRpc'), 0);
  }
});

test('no bearer, cross-work preview and malformed work IDs never initialize auth', async () => {
  for (const altered of [
    { bearer: null },
    { bearer: 'Bearer short' },
    { bearer: 'Bearer ' + TOKEN + '\nextra' },
    { expectedNovelId: 24 },
    { expectedNovelId: '23e0' },
    { preview: { ...preview(), novelId: 24 } },
    { preview: { ...preview(), aiGenerated: true } },
    { preview: { ...preview(), candidates: [] } }
  ]) {
    const f = fixture();
    assert.equal(await f.run(altered), null);
    assert.equal(count(f.state, 'getUser'), 0);
    assert.equal(count(f.state, 'authorRpc'), 0);
  }
});

test('not-the-owner, disabled login or failed ownership query return no private drafts', async () => {
  for (const change of [
    (s) => {
      s.actor = OTHER;
    },
    (s) => {
      s.novelOwner = OTHER;
    },
    (s) => {
      s.novelId = 24;
    },
    (s) => {
      s.authError = true;
    },
    (s) => {
      s.dbError = true;
    },
    (s) => {
      s.active = false;
    }
  ]) {
    const f = fixture();
    change(f.state);
    assert.equal(await f.run(), null);
    assert.equal(count(f.state, 'authorRpc'), 0);
  }
});

test('logging out after first RPC suppresses second RPC and clears result', async () => {
  const f = fixture();
  f.state.afterFirstRpc = () => {
    f.state.active = false;
  };
  assert.equal(await f.run(), null);
  assert.equal(count(f.state, 'authorRpc'), 1);
});

test('changing session binding mid-request suppresses second RPC', async () => {
  const f = fixture();
  f.state.afterFirstRpc = () => {
    f.state.binding = 'other-opaque-session';
  };
  assert.equal(await f.run(), null);
  assert.equal(count(f.state, 'authorRpc'), 1);
});

test('user switch, ownership transfer and logout after second RPC reject the response', async () => {
  for (const change of [
    (s) => {
      s.actor = OTHER;
    },
    (s) => {
      s.novelOwner = OTHER;
    },
    (s) => {
      s.binding = 'new-session-binding';
    },
    (s) => {
      s.active = false;
    },
    (s) => {
      s.dbError = true;
    }
  ]) {
    const f = fixture();
    f.state.afterSecondRpc = () => change(f.state);
    assert.equal(await f.run(), null);
    assert.equal(count(f.state, 'authorRpc'), 2);
  }
});

test('chapter move, reorder, draft publish and addition between reads are stale', async () => {
  for (const change of [
    (a) => {
      a[0].episode_number = 3;
    },
    (a) => {
      a[0].chapter_id = 25;
    },
    (a) => {
      a[0].chapter_title = '改題した章';
    },
    (a) => {
      a[0].episode_status = 'published';
    },
    (a) => {
      a[0].episode_title = '公開前の修正';
    },
    (a) => {
      a.pop();
    }
  ]) {
    const f = fixture();
    change(f.state.rpcData[1]);
    assert.equal(await f.run(), null);
    assert.equal(count(f.state, 'authorRpc'), 2);
  }
});

test('RPC failure, exception or impossible row shape fail closed without error disclosure', async () => {
  for (const change of [
    (s) => {
      s.rpcError = true;
    },
    (s) => {
      s.throwOnRpc = true;
    },
    (s) => {
      s.rpcData[1] = [{ ...rows()[0], chapter_id: undefined }];
    },
    (s) => {
      s.rpcData[1] = null;
    },
    (s) => {
      s.rpcData[1] = [{ ...rows()[0], novel_id: 999 }];
    }
  ]) {
    const f = fixture();
    change(f.state);
    const response = await f.run();
    assert.equal(response, null);
    assert.equal(
      Object.values(f.state.calls).some((x) =>
        JSON.stringify(x).includes(TOKEN)
      ),
      false
    );
  }
});

test('no live API route or browser script imports the future internal adapter', async () => {
  const adapter = await readFile(
    new URL(
      '../api/_lib/ai/owner-outline-internal-adapter.js',
      import.meta.url
    ),
    'utf8'
  );
  const apiRoute = await readFile(
    new URL('../api/ai-owner-novel-bible.js', import.meta.url),
    'utf8'
  );
  const privatePreview = await readFile(
    new URL('../api/_lib/ai/owner-novel-bible-preview.js', import.meta.url),
    'utf8'
  );
  const html = await readFile(
    new URL('../story-notes.html', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(apiRoute, /owner-outline-internal-adapter/);
  assert.doesNotMatch(privatePreview, /owner-outline-internal-adapter/);
  assert.doesNotMatch(html, /owner-outline-internal-adapter/);
  assert.doesNotMatch(
    adapter,
    /console\.|process\.env|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/
  );
});

test('service-role and secret API keys cannot be used for the author-bound outline client', async () => {
  const legacy = (role) =>
    'eyJhbGciOiJIUzI1NiJ9.' +
    Buffer.from(JSON.stringify({ role })).toString('base64url') +
    '.synthetic-not-signed';
  for (const badKey of [
    'sb_secret_synthetic_secret_key',
    legacy('service_role'),
    legacy('authenticated'),
    'eyJinvalid.not-json.fake'
  ]) {
    const f = fixture();
    const adapter = f.adapter({ config: { ...CONFIG, key: badKey } });
    assert.equal(
      await adapter.read({
        bearer: BEARER,
        expectedNovelId: 23,
        preview: preview()
      }),
      null
    );
    assert.equal(count(f.state, 'getUser'), 0);
    assert.equal(count(f.state, 'authorRpc'), 0);
  }

  const legacyAnon = fixture();
  assert.ok(
    await legacyAnon
      .adapter({
        config: { ...CONFIG, key: legacy('anon') }
      })
      .read({ bearer: BEARER, expectedNovelId: 23, preview: preview() })
  );
});
