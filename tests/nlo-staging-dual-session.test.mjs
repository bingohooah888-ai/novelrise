import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runNloStagingDualSessionOverlap,
  validateStagingConnectionConfig
} from '../scripts/nlo-staging-dual-session.mjs';

const REF = 'wmlzjgvxgoyrovdhbqbg';
const env = Object.freeze({
  NLO_STAGING_DUAL_SESSION_ENABLED: 'true',
  NLO_STAGING_DUAL_SESSION_PROJECT_REF: REF,
  NLO_STAGING_DUAL_SESSION_DATABASE_URL:
    'postgresql://postgres:fake@db.' + REF + '.supabase.co:5432/postgres'
});

function fakeFactory({ overlap = true, samePid = false } = {}) {
  const clients = [];
  function factory(options) {
    const i = clients.length;
    const base = Date.parse('2026-11-15T13:00:00.000Z');
    const start = new Date(base + (overlap ? i * 10 : i * 4000));
    const end = new Date(base + (overlap ? 2000 + i * 10 : 2000 + i * 4000));
    const ticks = [new Date(base - 100), start, end];
    const client = {
      options,
      statements: [],
      closed: false,
      connect: async () => {},
      end: async () => {
        client.closed = true;
      },
      query: async (statement) => {
        client.statements.push(statement);
        if (statement.startsWith('SELECT pg_backend_pid()')) {
          return {
            rows: [{ pid: samePid ? 100 : 100 + i, ts: ticks.shift() }]
          };
        }
        return { rows: [] };
      }
    };
    clients.push(client);
    return client;
  }
  return { clients, factory };
}

test('rejects production and unsafe connections by default', () => {
  assert.throws(
    () => validateStagingConnectionConfig({}),
    /nlo_staging_dual_session_disabled/
  );
  for (const bad of [
    env.NLO_STAGING_DUAL_SESSION_DATABASE_URL.replace(
      REF,
      'fiepaguycecrredwrcwx'
    ),
    'postgresql://postgres.fiepaguycecrredwrcwx:fake@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
    env.NLO_STAGING_DUAL_SESSION_DATABASE_URL.replace(':5432/', ':6543/'),
    env.NLO_STAGING_DUAL_SESSION_DATABASE_URL + '?sslmode=disable'
  ]) {
    assert.throws(
      () =>
        validateStagingConnectionConfig({
          ...env,
          NLO_STAGING_DUAL_SESSION_DATABASE_URL: bad
        }),
      /nlo_staging_database_scope_denied/
    );
  }
  assert.equal(
    validateStagingConnectionConfig(env),
    env.NLO_STAGING_DUAL_SESSION_DATABASE_URL
  );
});

test('two read-only sessions produce a verified overlap', async () => {
  const { clients, factory } = fakeFactory();
  const result = await runNloStagingDualSessionOverlap({
    env,
    clientFactory: factory
  });
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.overlapMs, 1990);
  assert.notEqual(result.a.pid, result.b.pid);
  assert.equal(result.casTested, false);
  for (const client of clients) {
    assert.equal(client.closed, true);
    assert.deepEqual(
      client.statements.filter((x) => !x.startsWith('SELECT pg_backend_pid()')),
      ['BEGIN TRANSACTION READ ONLY', 'SELECT pg_sleep(2)', 'ROLLBACK']
    );
    assert.deepEqual(client.options.ssl, { rejectUnauthorized: true });
  }
});

test('serialized windows cannot be falsely accepted', async () => {
  const { factory } = fakeFactory({ overlap: false });
  const result = await runNloStagingDualSessionOverlap({
    env,
    clientFactory: factory
  });
  assert.equal(result.verdict, 'NO_OVERLAP');
  assert.equal(result.overlapMs, 0);
});

test('same backend PID is denied and rolled back', async () => {
  const { factory, clients } = fakeFactory({ samePid: true });
  await assert.rejects(
    runNloStagingDualSessionOverlap({ env, clientFactory: factory }),
    /nlo_staging_shared_backend_denied/
  );
  assert.equal(
    clients.every((c) => c.statements.includes('ROLLBACK') && c.closed),
    true
  );
});
