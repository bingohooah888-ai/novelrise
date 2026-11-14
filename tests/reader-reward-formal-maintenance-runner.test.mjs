import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnregisteredFormalMaintenanceRunner } from '../api/_lib/reader-reward/formal-maintenance-runner.js';
import { FORMAL_MAINTENANCE_SAFETY_APPROVED } from '../api/_lib/reader-reward/formal-maintenance-release-gate.js';

const flags = {
  formalMaintenanceReviewEnabled: true,
  formalMaintenanceSchedulerEnabled: true,
  productionCutoverApproved: true
};
const authorization = {
  serviceRoleVerified: true,
  verifiedByTrustedServer: true
};
function runner(query, overrides = {}) {
  return createUnregisteredFormalMaintenanceRunner({
    postgresClient: { query },
    launchConfiguration: flags,
    trustedServerAuthorization: authorization,
    now: () => new Date('2027-03-01T00:00:00.000Z'),
    ...overrides
  });
}

test('release safety gate is deliberately hard-disabled', () => {
  assert.equal(FORMAL_MAINTENANCE_SAFETY_APPROVED, false);
});

test('factory rejects missing trusted dependencies', () => {
  assert.throws(() => createUnregisteredFormalMaintenanceRunner({}), TypeError);
  assert.throws(
    () =>
      createUnregisteredFormalMaintenanceRunner({
        postgresClient: { query() {} },
        now: 'invalid'
      }),
    TypeError
  );
});

test('all old launch flags true still cannot query or review', async () => {
  let calls = 0;
  const r = runner(async () => {
    calls++;
    return { rows: [] };
  });
  assert.deepEqual(await r.reviewDue(), {
    status: 'formal_maintenance_disabled',
    reviewed: 0,
    alreadyReviewed: 0,
    held: 0
  });
  assert.equal(calls, 0);
});

test('forged seal and cutover booleans do not bypass blocked release', async () => {
  let calls = 0;
  const r = runner(
    async () => {
      calls++;
      return { rows: [] };
    },
    {
      launchConfiguration: {
        ...flags,
        sealVerified: true,
        cutoverVerified: true
      },
      trustedServerAuthorization: { ...authorization, sealVerified: true }
    }
  );
  assert.equal((await r.reviewDue()).status, 'formal_maintenance_disabled');
  assert.equal(calls, 0);
});

test('no scheduler registration even when caller injects a valid callback', () => {
  let registrations = 0;
  const r = runner(async () => ({ rows: [] }));
  assert.equal(
    r.bindExistingScheduler({
      registerTick() {
        registrations++;
        return { unregister() {} };
      }
    }).status,
    'formal_maintenance_disabled'
  );
  assert.equal(registrations, 0);
});

test('invalid limits and even valid ticks cannot reach any SQL', async () => {
  let calls = 0;
  const r = runner(async () => {
    calls++;
    return { rows: [] };
  });
  for (const limit of [0, 1, 10, 25, 26, '10']) {
    assert.equal(
      (await r.reviewDue({ limit })).status,
      'formal_maintenance_disabled'
    );
  }
  assert.equal(calls, 0);
});

test('manual readiness inspection remains read-only and cannot start reviews', async () => {
  const queries = [];
  const r = runner(async (sql) => {
    queries.push(sql);
    return { rows: [{ ready: false }] };
  });
  assert.equal(
    (await r.inspectConnectionReadiness()).status,
    'maintenance_connection_unready'
  );
  assert.equal(queries.length, 1);
  assert.match(queries[0], /has_function_privilege/);
  assert.match(queries[0], /list_due_scout_30_day_reviews/);
  assert.match(queries[0], /review_scout_30_days_sealed/);
  assert.doesNotMatch(queries[0], /has_table_privilege/);
  assert.doesNotMatch(queries[0], /review_scout_30_days\(\$1/);
  assert.equal((await r.reviewDue()).status, 'formal_maintenance_disabled');
  assert.equal(queries.length, 1);
});

test('readiness errors do not leak SQL credentials', async () => {
  const r = runner(async () => {
    throw Error('private DB secret');
  });
  assert.deepEqual(await r.inspectConnectionReadiness(), {
    status: 'maintenance_connection_unavailable'
  });
});

test('concurrent denied ticks cannot issue XP queries or claims', async () => {
  let queries = 0;
  const r = runner(async () => {
    queries++;
    return { rows: [] };
  });
  const outcomes = await Promise.all(
    Array.from({ length: 20 }, () => r.reviewDue())
  );
  assert.ok(outcomes.every((x) => x.status === 'formal_maintenance_disabled'));
  assert.equal(queries, 0);
});
