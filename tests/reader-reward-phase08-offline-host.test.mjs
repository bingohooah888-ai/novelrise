import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUnregisteredFormalRewardHost,
  createUnregisteredFormalPostgresRewardHost
} from '../api/_lib/reader-reward/formal-usage-host.js';

const readerId = '00000000-0000-4000-8000-000000000301';
const operationId = '00000000-0000-4000-8000-000000000311';

test('unregistered formal Postgres host constructs without connecting to any database', async () => {
  let calls = 0;
  const pool = {
    query() {
      calls++;
      throw new Error('OFFLINE_TEST_MUST_NOT_QUERY');
    },
    connect() {
      calls++;
      throw new Error('OFFLINE_TEST_MUST_NOT_CONNECT');
    }
  };
  const host = createUnregisteredFormalPostgresRewardHost({
    pool,
    readFormalAccount: async () => ({}),
    readCanonicalPointHistory: async () => [],
    supabase: {
      auth: {
        getUser: async () => {
          throw new Error('OFFLINE_TEST_MUST_NOT_AUTHENTICATE');
        }
      }
    },
    releaseConfiguration: {
      formalRewardsEnabled: false,
      productionCutoverApproved: false
    },
    trustedServerAuthorization: {},
    catalog: []
  });

  assert.equal(typeof host.handlers.reader, 'function');
  assert.equal(typeof host.handlers.admin, 'function');
  assert.equal(calls, 0);

  const response = {
    statusCode: 200,
    result: null,
    setHeader() {},
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.result = value;
      return this;
    }
  };
  await host.handlers.reader(
    {
      method: 'GET',
      headers: {
        origin: 'https://novelight.jp',
        host: 'novelight.jp',
        'x-forwarded-proto': 'https',
        'sec-fetch-site': 'same-origin'
      }
    },
    response
  );
  assert.equal(response.statusCode, 401);
  assert.equal(response.result.error, 'UNAUTHORIZED');
  assert.equal(calls, 0);
  assert.equal(
    (
      await host.service.requestExchange({
        userId: readerId,
        operationId,
        amountPoints: 30000
      })
    ).status,
    'formal_use_disabled'
  );
  assert.equal(calls, 0);
});

test('missing injected PostgreSQL pool and trusted authentication fail closed', () => {
  assert.throws(
    () => createUnregisteredFormalPostgresRewardHost(),
    /Trusted PostgreSQL query executor required/
  );
  assert.throws(
    () =>
      createUnregisteredFormalRewardHost({
        repository: {
          transact() {
            throw new Error('OFFLINE_TEST_MUST_NOT_TRANSACT');
          },
          readReader() {
            throw new Error('OFFLINE_TEST_MUST_NOT_READ');
          },
          listPendingExchanges() {
            throw new Error('OFFLINE_TEST_MUST_NOT_LIST');
          },
          findOperation() {
            throw new Error('OFFLINE_TEST_MUST_NOT_FIND');
          }
        },
        releaseConfiguration: { formalRewardsEnabled: false }
      }),
    /Trusted existing Supabase Auth client required/
  );
});
