import { verifyStagingReadOnlyDatabaseTarget } from '../api/_lib/reader-reward/formal-staging-readonly-runtime.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  createFormalStagingReadOnlyHandler,
  createStagingReadOnlyFormalApplication,
  withStagingVerifiedReaderQuery,
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

test('existing Staging-only Preview aliases are accepted without weakening project pin', () => {
  const alias = {
    ...ACTIVE,
    STAGING_SUPABASE_URL: undefined,
    NOVELIGHT_STAGING_SUPABASE_URL: ACTIVE.STAGING_SUPABASE_URL,
    NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    PGSSLMODE: 'require',
    STAGING_FORMAL_RO_DATABASE_URL:
      'postgresql://novelight_formal_reader_ro:nonsecret@db.wmlzjgvxgoyrovdhbqbg.supabase.co:5432/postgres'
  };
  assert.equal(stagingReadOnlyGate(alias), true);
  const app = createStagingReadOnlyFormalApplication(alias);
  assert.equal(typeof app.readerHttp, 'function');
  assert.equal(typeof app.adminHttp, 'function');
  assert.equal(
    stagingReadOnlyGate({
      ...alias,
      NOVELIGHT_STAGING_SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co'
    }),
    false
  );
  assert.equal(
    stagingReadOnlyGate({
      ...alias,
      STAGING_SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co'
    }),
    false
  );
  assert.equal(
    stagingReadOnlyGate({
      ...alias,
      NOVELIGHT_SCOUT_FORMAL_STAGING_PROBE: undefined
    }),
    false
  );
  assert.equal(
    stagingReadOnlyGate({ ...alias, VERCEL_ENV: 'production' }),
    false
  );
  assert.throws(
    () =>
      createStagingReadOnlyFormalApplication({
        ...alias,
        STAGING_SUPABASE_PUBLISHABLE_KEY: 'wrong-key'
      }),
    /FORMAL_STAGING_AUTH_NOT_CONFIGURED/
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

test('verified Auth reader inspects only their canonical Point/XP and Level/Wallet, never auth.users', async () => {
  const queries = [];
  const pool = {
    async query() {
      throw Error('UNSCOPED_READER_QUERY');
    },
    async withVerifiedReaderQuery(userId, run) {
      assert.equal(userId, USER);
      return run(async (sql, args) => {
        queries.push({ sql, args });
        if (sql.includes(' as point_rows')) {
          return {
            rows: [
              {
                point_rows: '0',
                xp_rows: '0',
                level_rows: '0',
                wallet_rows: '0'
              }
            ]
          };
        }
        throw Error('UNEXPECTED_QUERY');
      });
    },
    async connect() {
      throw Error('WRITE_PATH_CALLED');
    }
  };
  const application = createUnregisteredFormalApplication({
    pool,
    supabase: {
      auth: {
        getUser: async () => ({
          data: {
            user: { id: USER, created_at: '2026-11-11T00:00:00.000Z' }
          }
        })
      }
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
  assert.equal(queries.length, 1);
  assert.deepEqual(
    queries.map((q) => q.args),
    [[USER]]
  );
  assert.equal(
    queries.some((q) => q.sql.includes('auth.users')),
    false
  );
  assert.equal(application.getNewReaderSummary, undefined);
  const earnings = await application.drainDueEarnings();
  assert.equal(earnings.status, 'formal_worker_disabled');
  const write = response();
  await handler(request('new_reader', 'POST'), write);
  assert.equal(write.code, 405);
  assert.equal(queries.length, 1);

  const admin = createFormalStagingReadOnlyHandler({
    role: 'admin',
    env: ACTIVE,
    build: () => application
  });
  const summary = response();
  await admin(request('new_readers'), summary);
  assert.equal(summary.code, 503);
  assert.equal(summary.body.error, 'FORMAL_NEW_READER_UNAVAILABLE');
  assert.equal(queries.length, 1);
});

test('missing Auth created_at fails closed without any DB read', async () => {
  let queried = 0;
  const app = createUnregisteredFormalApplication({
    pool: {
      query() {
        queried++;
        throw Error('UNSCOPED_READ');
      },
      withVerifiedReaderQuery() {
        queried++;
        throw Error('SHOULD_NOT_RUN');
      },
      connect() {
        throw Error('UNAPPROVED_WRITE');
      }
    },
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: USER } } }) }
    },
    stagingTestReferenceAt: '2026-11-10T00:00:00.000Z',
    stagingRef: STAGING_REF,
    releaseConfiguration: {},
    trustedServerAuthorization: {},
    env: ACTIVE
  });
  const route = createFormalStagingReadOnlyHandler({
    role: 'reader',
    env: ACTIVE,
    build: () => app
  });
  const res = response();
  await route(request('new_reader'), res);
  assert.equal(res.code, 503);
  assert.equal(res.body.error, 'FORMAL_NEW_READER_UNAVAILABLE');
  assert.equal(queried, 0);
});

test('scoped SQL uses transaction-local verified ID and clears it on commit or rollback', async () => {
  const calls = [];
  let released = 0;
  const connection = {
    async query(sql, args) {
      calls.push({ sql, args });
      if (sql.includes(' from public.scout_point_ledger')) {
        return { rows: [{ point_rows: '0' }] };
      }
      return { rows: [] };
    },
    release() {
      released++;
    }
  };
  const pool = { connect: async () => connection };
  const result = await withStagingVerifiedReaderQuery(pool, USER, (query) =>
    query(
      'select count(*) from public.scout_point_ledger where user_id=$1::uuid',
      [USER]
    )
  );
  assert.equal(result.rows[0].point_rows, '0');
  assert.equal(calls[0].sql, 'BEGIN READ ONLY');
  assert.match(
    calls[1].sql,
    /set_config\('novelight.formal_reader_id', \$1, true\)/
  );
  assert.deepEqual(calls[1].args, [USER]);
  assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.equal(released, 1);
  calls.length = 0;
  await assert.rejects(
    withStagingVerifiedReaderQuery(pool, USER, (query) =>
      query('update public.scout_point_ledger set point_value=1', [])
    ),
    /READ_ONLY_QUERY_REQUIRED/
  );
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(released, 2);
  await assert.rejects(
    withStagingVerifiedReaderQuery(pool, 'not-a-user', () => {}),
    /Verified reader/
  );
  assert.equal(released, 2);
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

test('Staging role draft grants only the 6 required table column sets, without auth.users', () => {
  assert.match(stagingRoleReviewSql, /NOT A MIGRATION/);
  assert.match(stagingRoleReviewSql, /wmlzjgvxgoyrovdhbqbg/);
  assert.match(stagingRoleReviewSql, /server-side[\s\S]*getUser/);
  assert.match(
    activeRoleReviewSql,
    /CREATE ROLE novelight_formal_reader_ro WITH[\s\S]*?NOLOGIN/
  );
  assert.match(activeRoleReviewSql, /\bNOBYPASSRLS\b/);
  assert.match(activeRoleReviewSql, /default_transaction_read_only = on/);
  assert.equal(
    (activeRoleReviewSql.match(/\bGRANT SELECT \(/g) || []).length,
    6
  );
  assert.equal(
    (activeRoleReviewSql.match(/\bCREATE POLICY novelight_formal_ro_/g) || [])
      .length,
    6
  );
  assert.doesNotMatch(activeRoleReviewSql, /\bauth\.users\b/i);
  assert.doesNotMatch(activeRoleReviewSql, /\bON SCHEMA auth\b/i);
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

test('Staging RLS read scope uses transaction-local verified reader and post-reference events', () => {
  assert.equal(
    (
      activeRoleReviewSql.match(
        /current_setting\('novelight.formal_reader_id', true\)/g
      ) || []
    ).length,
    4
  );
  assert.equal((activeRoleReviewSql.match(/\bnullif\(/g) || []).length, 4);
  assert.match(
    activeRoleReviewSql,
    /qualified_at >= timestamptz '2026-11-10T00:00:00Z'/
  );
  assert.match(
    activeRoleReviewSql,
    /created_at >= timestamptz '2026-11-10T00:00:00Z'/
  );
  assert.doesNotMatch(
    activeRoleReviewSql,
    /\bFOR (?:INSERT|UPDATE|DELETE|ALL)\b/i
  );
  assert.match(stagingRoleReviewSql, /admin GET \?view=new_readers: DISABLED/);
  assert.match(stagingRoleReviewSql, /Custom GUC values are/);
});
