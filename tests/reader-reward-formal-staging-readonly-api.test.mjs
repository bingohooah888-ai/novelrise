import { verifyStagingReadOnlyDatabaseTarget } from '../api/_lib/reader-reward/formal-staging-readonly-runtime.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  createFormalStagingReadOnlyHandler,
  createStagingReadOnlyFormalApplication,
  stagingReadOnlyGate
} from '../api/_lib/reader-reward/formal-staging-readonly-runtime.js';
import { createUnregisteredFormalApplication } from '../api/_lib/reader-reward/formal-application-host.js';
import readerEntry from '../api/scout-formal-reader.js';
import adminEntry from '../api/scout-formal-admin.js';

const STAGING_REF = 'wmlzjgvxgoyrovdhbqbg';
const USER = '11111111-1111-4111-8111-111111111111';
const READ = '22222222-2222-4222-8222-222222222222';
const COMMENT = '33333333-3333-4333-8333-333333333333';
const ACTIVE = {
  VERCEL_ENV: 'preview',
  NOVELIGHT_SCOUT_FORMAL_STAGING_PROBE: 'read-only',
  STAGING_PROJECT_REF: STAGING_REF,
  STAGING_SUPABASE_URL: 'https://' + STAGING_REF + '.supabase.co',
  NOVELIGHT_ADMIN_USER_IDS: USER
};
function response() {
  return {
    headers: {},
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
const headers = {
  authorization: 'Bearer verified-staging-token',
  origin: 'https://staging.example',
  host: 'staging.example',
  'x-forwarded-proto': 'https',
  'sec-fetch-site': 'same-origin'
};
function request(view, method = 'GET', extra = {}) {
  return {
    method,
    headers,
    query: { view, ...extra },
    url: '/api/scout-formal-reader',
    body: { action: 'initialize_new_formal_reader' }
  };
}

test('new staging route exports are callable but default-disabled', async () => {
  assert.equal(typeof readerEntry, 'function');
  assert.equal(typeof adminEntry, 'function');
  const prod = { ...ACTIVE, VERCEL_ENV: 'production' };
  assert.equal(stagingReadOnlyGate(prod), false);
  assert.equal(stagingReadOnlyGate(ACTIVE), true);
  let created = 0;
  const handler = createFormalStagingReadOnlyHandler({
    role: 'reader',
    env: prod,
    build: () => {
      created++;
      throw Error('SHOULD_NOT_BE_CALLED');
    }
  });
  const res = response();
  await handler(request('new_reader'), res);
  assert.equal(res.code, 404);
  assert.equal(created, 0);
  assert.throws(
    () => createFormalStagingReadOnlyHandler({ role: 'worker' }),
    TypeError
  );
});

test('read-only gate rejects every write and unrelated reward view before DB access', async () => {
  let created = 0;
  const handler = createFormalStagingReadOnlyHandler({
    role: 'reader',
    env: ACTIVE,
    build: () => {
      created++;
      throw Error('SHOULD_NOT_BE_CALLED');
    }
  });
  const post = response();
  await handler(request('new_reader', 'POST'), post);
  assert.equal(post.code, 405);
  const exchange = response();
  await handler(request('exchange'), exchange);
  assert.equal(exchange.code, 404);
  assert.equal(created, 0);
  const admin = createFormalStagingReadOnlyHandler({
    role: 'admin',
    env: ACTIVE,
    build: () => {
      created++;
      throw Error('SHOULD_NOT_BE_CALLED');
    }
  });
  const reviewPost = response();
  await admin(request('earning_source', 'POST'), reviewPost);
  assert.equal(reviewPost.code, 405);
  assert.equal(created, 0);
});

test('Staging database connection refuses a Production Postgres target before open', () => {
  const bad = {
    ...ACTIVE,
    STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    PGSSLMODE: 'require',
    STAGING_FORMAL_RO_DATABASE_URL:
      'postgresql://novelight_formal_reader_ro:nonsecret@db.fiepaguycecrredwrcwx.supabase.co:5432/postgres'
  };
  assert.throws(
    () => createStagingReadOnlyFormalApplication(bad),
    /FORMAL_STAGING_READER_DB_INVALID/
  );
});

test('authenticated reader can only inspect owned Staging Level/Wallet setup, not initialize', async () => {
  const queries = [];
  const pool = {
    async query(sql, args) {
      queries.push({ sql, args });
      if (sql.includes('from auth.users')) {
        return {
          rows: [{ id: USER, created_at: '2026-11-11T00:00:00.000Z' }]
        };
      }
      if (sql.includes(' as point_rows')) {
        return {
          rows: [
            { point_rows: '0', xp_rows: '0', level_rows: '0', wallet_rows: '0' }
          ]
        };
      }
      throw Error('UNEXPECTED_QUERY');
    },
    async connect() {
      throw Error('WRITE_PATH_CALLED');
    }
  };
  const application = createUnregisteredFormalApplication({
    pool,
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: USER } } }) }
    },
    now: () => Date.parse('2026-11-12T00:00:00.000Z'),
    stagingTestReferenceAt: '2026-11-10T00:00:00.000Z',
    stagingRef: STAGING_REF,
    releaseConfiguration: {},
    trustedServerAuthorization: {},
    env: ACTIVE
  });
  const handler = createFormalStagingReadOnlyHandler({
    role: 'reader',
    env: ACTIVE,
    build: () => application
  });
  const res = response();
  await handler(request('new_reader'), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.status, 'new_reader_ready_for_initialization');
  assert.equal(res.body.initialLevel, 1);
  assert.equal(res.body.initialAvailablePoints, 0);
  assert.deepEqual(
    queries.map((q) => q.args),
    [[USER], [USER]]
  );
  const earnings = await application.drainDueEarnings();
  assert.equal(earnings.status, 'formal_worker_disabled');
  const write = response();
  await handler(request('new_reader', 'POST'), write);
  assert.equal(write.code, 405);
  assert.equal(queries.length, 2);
});

test('admin read-only proof verifies read/comment source without exposing content', async () => {
  const queries = [];
  const pool = {
    async query(sql, args) {
      queries.push({ sql, args });
      if (sql.includes('from public.valid_read_events')) {
        return { rows: [{ id: READ, reader_id: USER }] };
      }
      if (
        sql.includes('from public.novel_comments') &&
        sql.includes('where id=')
      ) {
        return {
          rows: [
            {
              id: COMMENT,
              user_id: USER,
              episode_id: 7,
              body: 'DO-NOT-EXPOSE-COMMENT',
              created_at: '2026-11-12T00:00:00.000Z'
            }
          ]
        };
      }
      if (sql.includes('from public.novel_comments')) return { rows: [] };
      throw Error('UNEXPECTED_QUERY');
    },
    async connect() {
      throw Error('WRITE_PATH_CALLED');
    }
  };
  const application = createUnregisteredFormalApplication({
    pool,
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: USER } } }) }
    },
    stagingTestReferenceAt: '2026-11-10T00:00:00.000Z',
    stagingRef: STAGING_REF,
    releaseConfiguration: {},
    trustedServerAuthorization: {},
    env: ACTIVE
  });
  const handler = createFormalStagingReadOnlyHandler({
    role: 'admin',
    env: ACTIVE,
    build: () => application
  });
  for (const [eventType, eventId] of [
    ['valid_read_qualified', READ],
    ['novel_episode_comment_reviewed', COMMENT]
  ]) {
    const res = response();
    await handler(
      request('earning_source', 'GET', { eventType, eventId }),
      res
    );
    assert.equal(res.code, 200);
    assert.equal(res.body.status, 'canonical_source_verified');
    assert.equal(res.body.mayIssuePoints, false);
    assert.equal(JSON.stringify(res.body).includes('DO-NOT-EXPOSE'), false);
  }
  assert.equal(queries.length, 3);
  const unsupported = response();
  await handler(
    request('earning_source', 'GET', { eventType: 'award', eventId: READ }),
    unsupported
  );
  assert.equal(unsupported.code, 400);
  const forbidden = response();
  const crossOrigin = request('earning_source', 'GET', {
    eventType: 'valid_read_qualified',
    eventId: READ
  });
  crossOrigin.headers = { ...headers, origin: 'https://evil.example' };
  await handler(crossOrigin, forbidden);
  assert.equal(forbidden.code, 403);
  assert.equal(queries.length, 3);
});
test('read-only connection requires dedicated Staging role (never postgres)', () => {
  const good = {
    ...ACTIVE,
    PGSSLMODE: 'require',
    STAGING_FORMAL_RO_DATABASE_URL:
      'postgresql://novelight_formal_reader_ro:nonsecret@db.wmlzjgvxgoyrovdhbqbg.supabase.co:5432/postgres'
  };
  assert.equal(
    verifyStagingReadOnlyDatabaseTarget(good),
    good.STAGING_FORMAL_RO_DATABASE_URL
  );
  assert.throws(
    () =>
      verifyStagingReadOnlyDatabaseTarget({
        ...good,
        STAGING_FORMAL_RO_DATABASE_URL:
          good.STAGING_FORMAL_RO_DATABASE_URL.replace(
            'novelight_formal_reader_ro:',
            'postgres:'
          )
      }),
    /FORMAL_STAGING_READER_DB_INVALID/
  );
  assert.throws(
    () =>
      verifyStagingReadOnlyDatabaseTarget({
        ...good,
        PGSSLMODE: 'disable'
      }),
    /FORMAL_STAGING_READER_DB_INVALID/
  );
});
const stagingRoleReviewSql = readFileSync(
  new URL(
    '../docs/plans/SCOUT-FORMAL-STAGING-READONLY-ROLE-REVIEW-20261112.sql',
    import.meta.url
  ),
  'utf8'
);
const activeRoleReviewSql = stagingRoleReviewSql.replace(/^--.*$/gm, '');

test('Staging role review SQL is non-applied, NOLOGIN, owner-scoped and privilege-minimal', () => {
  assert.match(stagingRoleReviewSql, /NOT A MIGRATION/);
  assert.match(stagingRoleReviewSql, /wmlzjgvxgoyrovdhbqbg/);
  assert.match(stagingRoleReviewSql, /supabase_auth_admin/);
  assert.match(
    activeRoleReviewSql,
    /CREATE ROLE novelight_formal_reader_ro WITH[\s\S]*?NOLOGIN/
  );
  assert.match(activeRoleReviewSql, /\bNOBYPASSRLS\b/);
  assert.match(activeRoleReviewSql, /default_transaction_read_only = on/);
  assert.match(
    activeRoleReviewSql,
    /GRANT SELECT \(id, created_at\) ON auth\.users/
  );
  assert.match(
    activeRoleReviewSql,
    /GRANT SELECT \(user_id\)[\s\S]*?scout_point_ledger/
  );
  assert.match(
    activeRoleReviewSql,
    /GRANT SELECT \(id, reader_id, episode_id_snapshot, qualified_at\)/
  );
  assert.match(
    activeRoleReviewSql,
    /GRANT SELECT \([\s\S]*?body, deleted_at, author_hidden_at, created_at/
  );
  assert.equal(
    (
      activeRoleReviewSql.match(
        /\bCREATE POLICY novelight_formal_ro_post_reference/g
      ) || []
    ).length,
    7
  );
  assert.equal(
    (activeRoleReviewSql.match(/\bGRANT SELECT \(/g) || []).length,
    7
  );
  assert.doesNotMatch(
    activeRoleReviewSql,
    /\bGRANT\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE|EXECUTE)\b/i
  );
  assert.doesNotMatch(activeRoleReviewSql, /\bGRANT\s+SELECT\s+ON\b/i);
  assert.doesNotMatch(
    activeRoleReviewSql,
    /\b(?:INSERT INTO|UPDATE|DELETE FROM|DROP TABLE|ALTER TABLE|CREATE TRIGGER|CREATE FUNCTION)\b/i
  );
  assert.doesNotMatch(activeRoleReviewSql, /\b(?:PASSWORD|LOGIN)\s+'[^']+'/i);
});

test('Staging RLS proposal allows post-reference synthetic cohort only', () => {
  assert.equal(
    (activeRoleReviewSql.match(/TO novelight_formal_reader_ro/g) || [])
      .length >= 14,
    true
  );
  assert.equal(
    (
      activeRoleReviewSql.match(
        /created_at >= timestamptz '2026-11-10T00:00:00Z'/g
      ) || []
    ).length,
    8
  );
  assert.match(
    activeRoleReviewSql,
    /qualified_at >= timestamptz '2026-11-10T00:00:00Z'/
  );
  assert.match(
    activeRoleReviewSql,
    /ON auth\.users FOR SELECT\s+TO novelight_formal_reader_ro/
  );
  assert.doesNotMatch(
    activeRoleReviewSql,
    /\bFOR (?:INSERT|UPDATE|DELETE|ALL)\b/i
  );
});
