import assert from 'node:assert/strict';
import test from 'node:test';
import { createNovemberContestReaderHandler } from '../api/_lib/november-contest-reader.js';

const UID = 'a04566c5-bc6e-4c0f-81a9-d05c6a4d3203';
const READER = 'bf4561a1-806c-418e-b137-57db06f137e2';
const SESSION = 'f283680a-01f1-48b1-b648-0d4ca9c24694';
const CONTEST = 'cee57809-ed21-4da9-89ae-626487ab0484';
const NOW = Date.parse('2026-11-02T00:00:00Z');
const SECRET = 'test-contest-guest-purpose-specific-secret-strong-enough';

function response() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(n) { this.statusCode = n; return this; },
    json(v) { this.data = v; return this; }
  };
}

function request(body, extras = {}) {
  return {
    method: 'POST',
    headers: { origin: 'https://novelight.jp', host: 'novelight.jp', ...extras },
    body
  };
}

function mockDatabase({ userId, active = true, owner = true } = {}) {
  const calls = [];
  let reader = null;
  const database = {
    calls,
    auth: {
      async getUser(token) {
        calls.push(['getUser', token]);
        return token === 'valid-token'
          ? { data: { user: { id: userId || UID } }, error: null }
          : { data: null, error: new Error('bad token') };
      }
    },
    from(table) {
      const clauses = [];
      const query = {
        select() { return this; },
        eq(name, value) { clauses.push([name, value]); return this; },
        async maybeSingle() {
          calls.push(['find', table, clauses]);
          if (table === 'novelight_contests') return {
            data: {
              id: CONTEST,
              status: active ? 'active' : 'draft',
              public_visible: active,
              starts_at: '2026-11-01T00:00:00Z',
              ends_at: '2026-11-30T15:00:00Z'
            }, error: null
          };
          if (table === 'novelight_contest_readers') return { data: reader, error: null };
          if (table === 'novelight_contest_read_sessions') {
            return { data: owner ? { id: SESSION } : null, error: null };
          }
          throw new Error('Unexpected table ' + table);
        },
        insert(values) {
          calls.push(['insert', table, values]);
          reader = { id: READER, review_status: 'provisional' };
          return {
            select() {
              return { async single() { return { data: reader, error: null }; } };
            }
          };
        }
      };
      return query;
    },
    async rpc(name, args) {
      calls.push(['rpc', name, args]);
      if (name === 'novelight_contest_begin_read_session') {
        return { data: { ok: true, session_id: SESSION, reading_mode: args.p_mode }, error: null };
      }
      if (name === 'novelight_contest_heartbeat_read_session') {
        return { data: { ok: true, qualified: true }, error: null };
      }
      if (name === 'novelight_contest_record_qualified_session') {
        return { data: { ok: true }, error: null };
      }
      throw new Error('Unexpected RPC');
    }
  };
  return database;
}

function handler(db, opts = {}) {
  return createNovemberContestReaderHandler({
    serviceClient: db, guestSecret: SECRET, enabled: true, now: () => NOW, ...opts
  });
}

test('disabled API does not query backend or create identities', async () => {
  const db = mockDatabase();
  const res = response();
  await createNovemberContestReaderHandler({
    serviceClient: db, guestSecret: SECRET, enabled: false
  })(request({ action: 'start', episode_id: 1, mode: 'scroll' }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(db.calls.length, 0);
});

test('draft never creates a guest cookie or reader', async () => {
  const db = mockDatabase({ active: false });
  const res = response();
  await handler(db)(request({ action: 'start', episode_id: 1, mode: 'scroll' }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['Set-Cookie'], undefined);
  assert.equal(db.calls.filter((c) => c[0] === 'insert').length, 0);
});

test('cross-site or spoofed Origin and supplied reader ID are rejected', async () => {
  const db = mockDatabase();
  for (const req of [
    request({ action: 'start', episode_id: 1, mode: 'scroll' }, { origin: 'https://evil.test' }),
    request({ action: 'start', episode_id: 1, mode: 'scroll' }, { host: 'evil.test' }),
    request({ action: 'start', episode_id: 1, mode: 'scroll' }, { 'sec-fetch-site': 'cross-site' })
  ]) {
    const res = response();
    await handler(db)(req, res);
    assert.equal(res.statusCode, 403);
  }
  const res = response();
  await handler(db)(request({
    action: 'start', episode_id: 1, mode: 'scroll', reader_id: UID
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.length, 0);
});

test('verified authenticated user always derives reader identity on server', async () => {
  const db = mockDatabase();
  const res = response();
  await handler(db)(request(
    { action: 'start', episode_id: 8, mode: 'tts' },
    { authorization: 'Bearer valid-token' }
  ), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.session_id, SESSION);
  assert.equal(res.headers['Set-Cookie'], undefined);
  const inserted = db.calls.find((call) => call[0] === 'insert');
  assert.equal(inserted[2].user_id, UID);
  assert.equal(inserted[2].kind, 'account');
  assert.equal(
    db.calls.find((call) => call[1] === 'novelight_contest_begin_read_session')[2].p_reader_id,
    READER
  );
});

test('invalid Bearer is never downgraded to a guest reader', async () => {
  const db = mockDatabase();
  const res = response();
  await handler(db)(request(
    { action: 'start', episode_id: 8, mode: 'scroll' },
    { authorization: 'Bearer invalid-token' }
  ), res);
  assert.equal(res.statusCode, 401);
  assert.equal(db.calls.some((call) => call[0] === 'insert'), false);
});

test('guest cookie is signed HttpOnly and reused without exposing reader ID', async () => {
  const db = mockDatabase();
  const res = response();
  await handler(db)(request({ action: 'start', episode_id: 8, mode: 'scroll' }), res);
  assert.equal(res.statusCode, 200);
  const cookie = res.headers['Set-Cookie'];
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.doesNotMatch(cookie, new RegExp(READER));
  const second = response();
  await handler(db)(request(
    { action: 'start', episode_id: 9, mode: 'scroll' },
    { cookie: cookie.split(';')[0] }
  ), second);
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['Set-Cookie'], undefined);
});

test('heartbeat enforces reader ownership and records only provisional qualification', async () => {
  const db = mockDatabase();
  const base = { action: 'heartbeat', session_id: SESSION, sequence: 1,
    progress_ratio: 0.85, foreground: true, interacted: true };
  const unauthorized = response();
  await handler(db)(request(base, { authorization: 'Bearer valid-token' }), unauthorized);
  assert.equal(unauthorized.statusCode, 200);
  assert.equal(unauthorized.data.provisional_only, true);
  assert.deepEqual(
    db.calls.filter((c) => c[0] === 'rpc').map((c) => c[1]),
    ['novelight_contest_heartbeat_read_session', 'novelight_contest_record_qualified_session']
  );
  const ownerMismatch = mockDatabase({ owner: false });
  const denied = response();
  await handler(ownerMismatch)(request(base, {
    authorization: 'Bearer valid-token'
  }), denied);
  assert.equal(denied.statusCode, 404);
  assert.equal(ownerMismatch.calls.some((c) => c[0] === 'rpc'), false);
});

test('invalid report fields, missing guest session, invalid cookie are rejected', async () => {
  const db = mockDatabase();
  const noGuest = response();
  await handler(db)(request({
    action: 'heartbeat', session_id: SESSION, sequence: 1,
    progress_ratio: 0.8, foreground: true, interacted: true
  }), noGuest);
  assert.equal(noGuest.statusCode, 401);
  const invalid = response();
  await handler(db)(request({
    action: 'heartbeat', session_id: SESSION, sequence: 1,
    progress_ratio: 3, foreground: true, interacted: true
  }), invalid);
  assert.equal(invalid.statusCode, 400);
  const forged = response();
  await handler(db)(request(
    { action: 'start', episode_id: 1, mode: 'scroll' },
    { cookie: '__Host-novelight-contest-guest=v1.bad.signature' }
  ), forged);
  assert.equal(forged.statusCode, 401);
});
