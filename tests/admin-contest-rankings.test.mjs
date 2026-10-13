import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminContestRankingsHandler } from '../api/_lib/admin-contest-rankings.js';

const ADMIN = 'caf00000-0000-4000-8000-000000000099';
const CONTEST = 'caf00000-0000-4000-8000-000000000090';
const SNAPSHOT = 'caf00000-0000-4000-8000-000000000098';
const CHECKSUM = '0123456789abcdef0123456789abcdef';

function response() {
  return {
    headers: {},
    code: 200,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(data) { this.body = data; return this; }
  };
}

function request(method, body, headers = {}) {
  return {
    method,
    body,
    headers: {
      origin: 'https://novelight.jp',
      host: 'novelight.jp',
      authorization: 'Bearer admin-session',
      ...headers
    }
  };
}

function database({ active = true } = {}) {
  const calls = [];
  const supabase = {
    auth: {
      async getUser(token) {
        return {
          data: { user: token === 'admin-session'
            ? { id: ADMIN, email: 'admin@example.test' }
            : null },
          error: null
        };
      }
    },
    from(table) {
      assert.equal(table, 'novelight_contests');
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return {
            data: {
              id: CONTEST,
              status: active ? 'active' : 'draft',
              public_visible: active
            },
            error: null
          };
        }
      };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return name === 'novelight_contest_rank_release_preview'
        ? { data: { ok: true, available: false, slot: args.p_slot }, error: null }
        : { data: { ok: true, action: args.p_action }, error: null };
    }
  };
  return { supabase, calls };
}

const note = 'Manually reviewed this ranking snapshot for publication';
const releaseBody = {
  action: 'publish',
  slot: 1,
  confirmation: '発表承認',
  expected_checksum: CHECKSUM,
  expected_snapshot_id: SNAPSHOT,
  note
};

test('ranking admin requires verified administrator and same origin', async () => {
  const { supabase, calls } = database();
  const handler = createAdminContestRankingsHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN }
  });
  for (const headers of [
    { authorization: '' },
    { authorization: 'Bearer wrong-session' },
    { origin: 'https://attacker.example' },
    { origin: '' }
  ]) {
    const res = response();
    await handler(request('POST', releaseBody, headers), res);
    assert.ok([401, 403].includes(res.code));
  }
  assert.equal(calls.length, 0);
});

test('default gate blocks all ranking writes while preserving private reads', async () => {
  const { supabase, calls } = database();
  const handler = createAdminContestRankingsHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN }
  });
  const post = response();
  await handler(request('POST', releaseBody), post);
  assert.equal(post.code, 403);
  assert.equal(post.body.error, 'RELEASE_GATE_DISABLED');
  assert.equal(calls.length, 0);
  const get = response();
  await handler(request('GET'), get);
  assert.equal(get.code, 200);
  assert.equal(get.body.slots.length, 3);
  assert.equal(get.body.admin_release_enabled, false);
  assert.equal(get.headers['Cache-Control'], 'private, no-store, max-age=0');
});

test('publish requires exact review confirmation and forwards verified actor', async () => {
  const { supabase, calls } = database();
  const handler = createAdminContestRankingsHandler({
    supabase,
    env: {
      NOVELIGHT_ADMIN_USER_IDS: ADMIN,
      NOVELIGHT_CONTEST_RANKING_ADMIN_RELEASE_ENABLED: 'true'
    }
  });
  const missing = response();
  await handler(request('POST', { ...releaseBody, confirmation: 'yes' }), missing);
  assert.equal(missing.code, 400);
  assert.equal(calls.length, 0);
  const okay = response();
  await handler(request('POST', releaseBody), okay);
  assert.equal(okay.code, 200);
  assert.equal(okay.body.awards_finalized, false);
  assert.deepEqual(calls[0], {
    name: 'novelight_contest_admin_rank_action',
    args: {
      p_contest_id: CONTEST,
      p_slot: 1,
      p_actor_user_id: ADMIN,
      p_action: 'publish',
      p_expected_snapshot_id: SNAPSHOT,
      p_expected_checksum: CHECKSUM,
      p_note: note
    }
  });
});

test('hidden contest prevents write even with admin release enabled', async () => {
  const { supabase, calls } = database({ active: false });
  const handler = createAdminContestRankingsHandler({
    supabase,
    env: {
      NOVELIGHT_ADMIN_USER_IDS: ADMIN,
      NOVELIGHT_CONTEST_RANKING_ADMIN_RELEASE_ENABLED: 'true'
    }
  });
  const res = response();
  await handler(request('POST', releaseBody), res);
  assert.equal(res.code, 409);
  assert.equal(res.body.error, 'CONTEST_NOT_LIVE');
  assert.equal(calls.length, 0);
});
