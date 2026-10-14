import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

import { createAdminContestOperationsHandler } from '../api/_lib/admin-contest-operations.js';

const ADMIN = 'caf00000-0000-4000-8000-000000000099';
const CONTEST = 'caf00000-0000-4000-8000-000000000090';
const migration = readFileSync(
  new URL(
    '../supabase/migrations/20261014230000_november_contest_admin_operations_overview.sql',
    import.meta.url
  ),
  'utf8'
);
const rollback = readFileSync(
  new URL(
    '../supabase/rollback/20261014230000_november_contest_admin_operations_overview_rollback.sql',
    import.meta.url
  ),
  'utf8'
);
const frontend = readFileSync(
  new URL('../admin-contest-operations.js', import.meta.url),
  'utf8'
);

function response() {
  return {
    code: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

function request(method = 'GET', query = {}, headers = {}) {
  return {
    method,
    query,
    headers: {
      host: 'novelight.jp',
      origin: 'https://novelight.jp',
      authorization: 'Bearer admin-session',
      ...headers
    }
  };
}

function database({ rpcError = false } = {}) {
  const calls = [];
  const supabase = {
    auth: {
      async getUser(token) {
        return {
          data: {
            user:
              token === 'admin-session'
                ? { id: ADMIN, email: 'admin@example.test' }
                : null
          },
          error: null
        };
      }
    },
    from(table) {
      calls.push({ table });
      assert.equal(table, 'novelight_contests');
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: { id: CONTEST }, error: null };
        }
      };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return rpcError
        ? { data: null, error: { message: 'database unavailable' } }
        : {
            data: {
              ok: true,
              contest_status: 'draft',
              public_visible: false,
              total: 0,
              entries: [],
              audit: [],
              summary: { entered: 0 },
              provisional_only: true
            },
            error: null
          };
    }
  };
  return { supabase, calls };
}

test('GET requires verified administrator and same origin', async () => {
  const { supabase, calls } = database();
  const handler = createAdminContestOperationsHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN }
  });
  for (const headers of [
    { authorization: '' },
    { authorization: 'Bearer invalid' },
    { origin: 'https://attacker.example' },
    { 'sec-fetch-site': 'cross-site' }
  ]) {
    const res = response();
    await handler(request('GET', {}, headers), res);
    assert.ok([401, 403].includes(res.code));
  }
  assert.equal(calls.length, 0);
});

test('operations page reads only the service-role private RPC', async () => {
  const { supabase, calls } = database();
  const handler = createAdminContestOperationsHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN }
  });
  const res = response();
  await handler(
    request('GET', { page: '2', limit: '10', status: 'entered' }),
    res
  );
  assert.equal(res.code, 200);
  assert.equal(res.body.contest_status, 'draft');
  assert.equal(res.body.public_visible, false);
  assert.equal(res.body.payment_actions_available, false);
  assert.equal(res.body.awards_finalized_here, false);
  assert.equal(res.body.page, 2);
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.deepEqual(calls.at(-1), {
    name: 'novelight_contest_admin_operations_overview',
    args: {
      p_contest_id: CONTEST,
      p_entry_status: 'entered',
      p_limit: 10,
      p_offset: 10
    }
  });
});

test('non-GET and unbounded pagination fail closed', async () => {
  const { supabase, calls } = database();
  const handler = createAdminContestOperationsHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN }
  });
  const post = response();
  await handler(request('POST'), post);
  assert.equal(post.code, 405);
  for (const query of [
    { page: '0' },
    { page: '102' },
    { limit: '1000' },
    { status: 'paid' },
    { status: ['all', 'entered'] }
  ]) {
    const res = response();
    await handler(request('GET', query), res);
    assert.equal(res.code, 400);
  }
  assert.equal(calls.length, 0);
});

test('operations fails closed when private aggregation fails', async () => {
  const { supabase } = database({ rpcError: true });
  const handler = createAdminContestOperationsHandler({
    supabase,
    env: { NOVELIGHT_ADMIN_USER_IDS: ADMIN }
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 500);
  assert.equal(res.body.error, 'OPERATIONS_UNAVAILABLE');
});

test('private SQL permits only service role and never writes', () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(
    migration,
    /revoke all on function\s+public\.novelight_contest_admin_operations_overview\(uuid,text,integer,integer\)\s+from public,anon,authenticated/i
  );
  assert.match(
    migration,
    /grant execute on function\s+public\.novelight_contest_admin_operations_overview\(uuid,text,integer,integer\)\s+to service_role/i
  );
  assert.match(
    migration,
    /reader\.review_status in \('provisional','cleared'\)/i
  );
  assert.match(migration, /s\.review_status in \('provisional','cleared'\)/i);
  assert.match(migration, /p_offset > 2000/i);
  assert.doesNotMatch(
    migration,
    /\b(?:insert into|update public|delete from)\b/i
  );
  assert.match(rollback, /drop function if exists/i);
  assert.doesNotMatch(rollback, /(?:drop table|truncate|delete from)/i);
});

test('operator UI shows text only and cannot write', () => {
  assert.match(frontend, /textContent/);
  assert.doesNotMatch(frontend, /innerHTML/);
  assert.doesNotMatch(frontend, /\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/);
  assert.match(frontend, /admin-contest-operations/);
});
