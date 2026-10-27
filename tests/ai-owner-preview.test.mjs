import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOwnerNovelBiblePreviewHandler,
  resolveOwnerNovelBiblePreviewConfig
} from '../api/_lib/ai/owner-novel-bible-preview.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'verified-author-jwt-token';
const ENV = {
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
  NOVELIGHT_ADMIN_USER_IDS: OWNER + ',' + OTHER,
  SUPABASE_URL: 'https://sample.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fake_public_key'
};

function reply() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
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

function fixture({ userId = OWNER, ownerId = OWNER, failRpc = '' } = {}) {
  const calls = [];
  const serviceClient = {
    auth: {
      async getUser(token) {
        calls.push(['getUser', token]);
        return token === TOKEN
          ? { data: { user: { id: userId, email: 'author@example.jp' } } }
          : { data: { user: null }, error: { message: 'bad token' } };
      }
    },
    rpc() {
      throw new Error('service-role RPC forbidden');
    },
    from(table) {
      calls.push(['from', table]);
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        async maybeSingle() {
          return { data: { id: 14, user_id: ownerId }, error: null };
        },
        async limit() {
          return { data: [], error: null };
        }
      };
      return query;
    }
  };
  const createAuthorClient = (url, key, options) => {
    calls.push(['authorClient', url, key, options]);
    return {
      async rpc(name, args) {
        calls.push(['authorRpc', name, args]);
        if (name === failRpc) return { data: null, error: { code: '42501' } };
        if (name === 'novelight_author_character_list') {
          return { data: [{ id: 5, name: 'Hero', aliases: [] }], error: null };
        }
        return {
          data: [
            {
              id: 7,
              note_type: 'character',
              character_id: 5,
              title: 'Secret plan',
              body: 'Confidential ending'
            }
          ],
          error: null
        };
      }
    };
  };
  async function run({
    env = ENV,
    method = 'GET',
    headers = {
      authorization: 'Bearer ' + TOKEN,
      origin: 'https://novelight.jp',
      host: 'novelight.jp',
      'sec-fetch-site': 'same-origin'
    },
    query = { novel_id: '14' }
  } = {}) {
    const res = reply();
    const handler = createOwnerNovelBiblePreviewHandler({
      serviceClient,
      createAuthorClient,
      env
    });
    await handler({ method, headers, query }, res);
    return res;
  }
  return { run, calls };
}

test('default-off flag rejects without even checking authentication', async () => {
  const f = fixture();
  const res = await f.run({
    env: { ...ENV, NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'false' }
  });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(f.calls, []);
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
});

test('verified owner reads canonical private notes and no-cost fact groups', async () => {
  const f = fixture();
  const res = await f.run();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.characters[0].name, 'Hero');
  assert.equal(res.body.notes[0].body, 'Confidential ending');
  assert.deepEqual(res.body.facts, []);
  assert.equal(res.body.aiGenerated, false);
  assert.deepEqual(
    f.calls.filter((c) => c[0] === 'authorRpc').map((c) => c[1]),
    ['novelight_author_character_list', 'novelight_private_story_notes']
  );
  const authorClient = f.calls.find((c) => c[0] === 'authorClient');
  assert.equal(authorClient[1], ENV.SUPABASE_URL);
  assert.equal(authorClient[3].global.headers.Authorization, 'Bearer ' + TOKEN);
});

test('other admins and owners of other works never reach private RPCs', async () => {
  for (const options of [{ userId: OTHER }, { ownerId: OTHER }]) {
    const f = fixture(options);
    const res = await f.run();
    assert.equal(res.statusCode, 404);
    assert.equal(
      f.calls.some((c) => c[0] === 'authorRpc'),
      false
    );
  }
});

test('unauthenticated and cross-origin access is denied', async () => {
  const f = fixture();
  const anonymous = await f.run({
    headers: { host: 'novelight.jp' }
  });
  assert.equal(anonymous.statusCode, 401);
  const crossSite = await f.run({
    headers: {
      authorization: 'Bearer ' + TOKEN,
      origin: 'https://other.example',
      host: 'novelight.jp',
      'sec-fetch-site': 'cross-site'
    }
  });
  assert.equal(crossSite.statusCode, 403);
});

test('method, invalid work IDs and preview configuration fail closed', async () => {
  const f = fixture();
  assert.equal((await f.run({ method: 'POST' })).statusCode, 405);
  for (const novel_id of [
    '0',
    '-3',
    '1e1',
    ' 14',
    ['14'],
    '999999999999999999'
  ]) {
    assert.equal((await f.run({ query: { novel_id } })).statusCode, 400);
  }
  for (const changes of [
    { NOVELIGHT_AI_ADMIN_USER_ID: '' },
    { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_restricted' },
    { SUPABASE_URL: 'https://other.example' },
    { SUPABASE_URL: 'http://sample.supabase.co' }
  ]) {
    assert.equal(
      (await f.run({ env: { ...ENV, ...changes } })).statusCode,
      503
    );
  }
});

test('private RPC failures never leak manuscripts', async () => {
  const f = fixture({ failRpc: 'novelight_private_story_notes' });
  const res = await f.run();
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(
    JSON.stringify(res.body),
    /Secret plan|Confidential ending/
  );
});

test('owner-only preview is independent from site-wide administrator allowlist', async () => {
  for (const changes of [
    { NOVELIGHT_ADMIN_USER_IDS: OTHER },
    { NOVELIGHT_ADMIN_USER_IDS: '' },
    { NOVELIGHT_ADMIN_USER_IDS: 'invalid-admin-uuid' }
  ]) {
    const env = { ...ENV, ...changes };
    assert.equal(resolveOwnerNovelBiblePreviewConfig(env)?.id, OWNER);
    const authorized = fixture();
    assert.equal((await authorized.run({ env })).statusCode, 200);
    const other = fixture({ userId: OTHER });
    assert.equal((await other.run({ env })).statusCode, 404);
    assert.equal(other.calls.some((call) => call[0] === 'from'), false);
  }
});

test('preview rejects incomplete dedicated owner config before authentication', async () => {
  for (const changes of [
    { NOVELIGHT_AI_ADMIN_USER_ID: '' },
    { NOVELIGHT_AI_ADMIN_USER_ID: 'invalid-owner-uuid' },
    { SUPABASE_PUBLISHABLE_KEY: '' },
    { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_not_public' },
    { SUPABASE_URL: 'https://untrusted.example' }
  ]) {
    const env = { ...ENV, ...changes };
    assert.equal(resolveOwnerNovelBiblePreviewConfig(env), null);
    const f = fixture();
    const response = await f.run({ env });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(f.calls, []);
  }
});

test('a different configured preview owner never inherits admin access', async () => {
  const f = fixture();
  const res = await f.run({
    env: { ...ENV, NOVELIGHT_AI_ADMIN_USER_ID: OTHER }
  });
  assert.equal(res.statusCode, 404);
  assert.equal(f.calls.some((call) => call[0] === 'from'), false);
});
