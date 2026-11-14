import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnregisteredFormalMaintenanceRunner } from '../api/_lib/reader-reward/formal-maintenance-runner.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const CLOCK = '2027-03-01T00:00:00.000Z';
const flags = {
  formalMaintenanceReviewEnabled: true,
  formalMaintenanceSchedulerEnabled: true,
  productionCutoverApproved: true
};
const authorization = {
  serviceRoleVerified: true,
  verifiedByTrustedServer: true
};
function make(client, extra = {}) {
  // Existing test clients simulate a future verified trusted SQL session.
  // Privilege denial is exercised separately using an unwrapped client.
  const verifiedClient = {
    query(sql, params) {
      if (sql.startsWith('select (has_schema_privilege(current_user'))
        return Promise.resolve({ rows: [{ ready: true }] });
      return client.query(sql, params);
    }
  };
  return createUnregisteredFormalMaintenanceRunner({
    postgresClient: verifiedClient,
    launchConfiguration: flags,
    trustedServerAuthorization: authorization,
    now: () => new Date(CLOCK),
    ...extra
  });
}

test('independent launch flags and trusted service role are mandatory before any DB/scheduler call', async () => {
  let queries = 0;
  let registrations = 0;
  const client = {
    query: async () => {
      queries++;
      return { rows: [] };
    }
  };
  assert.throws(() => createUnregisteredFormalMaintenanceRunner({}), TypeError);
  const variants = [
    {
      launchConfiguration: { ...flags, formalMaintenanceReviewEnabled: false }
    },
    {
      launchConfiguration: {
        ...flags,
        formalMaintenanceSchedulerEnabled: false
      }
    },
    { launchConfiguration: { ...flags, productionCutoverApproved: false } },
    {
      trustedServerAuthorization: {
        ...authorization,
        serviceRoleVerified: false
      }
    },
    {
      trustedServerAuthorization: {
        ...authorization,
        verifiedByTrustedServer: false
      }
    },
    { launchConfiguration: {} }
  ];
  for (const variant of variants) {
    const runner = make(client, variant);
    assert.equal(
      (await runner.reviewDue()).status,
      'formal_maintenance_disabled'
    );
    assert.equal(
      runner.bindExistingScheduler({
        registerTick: () => {
          registrations++;
        }
      }).status,
      'formal_maintenance_disabled'
    );
  }
  assert.equal(queries, 0);
  assert.equal(registrations, 0);
});

test('read-only privilege preflight blocks review before any due-user query or private RPC', async () => {
  const calls = [];
  const deniedDb = {
    async query(sql) {
      calls.push(sql);
      return { rows: [{ ready: false }] };
    }
  };
  const runner = make(deniedDb, { postgresClient: deniedDb });
  assert.deepEqual(await runner.inspectConnectionReadiness(), {
    status: 'maintenance_connection_unready'
  });
  assert.equal(
    (await runner.reviewDue()).status,
    'maintenance_connection_unready'
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every((sql) => sql.includes('row_security_active(')));
  assert.ok(
    calls.every((sql) => sql.startsWith('select (has_schema_privilege('))
  );
  assert.ok(
    calls.every(
      (sql) => !sql.includes('from novelight_formal_private.scout_level_state')
    )
  );

  const missingDb = { query: async () => ({ rows: [{ ready: 'true' }] }) };
  assert.equal(
    (await make(missingDb, { postgresClient: missingDb }).reviewDue()).status,
    'maintenance_connection_unavailable'
  );
  const brokenDb = {
    query: async () => {
      throw Error('private DB password');
    }
  };
  const failure = await make(brokenDb, {
    postgresClient: brokenDb
  }).reviewDue();
  assert.equal(failure.status, 'maintenance_connection_unavailable');
  assert.equal(JSON.stringify(failure).includes('password'), false);
});

test('bounded due list invokes installed private review once per verified user', async () => {
  const calls = [];
  const runner = make({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('from novelight_formal_private.scout_level_state')) {
        return { rows: [{ user_id: USER_A }, { user_id: USER_B }] };
      }
      return {
        rows: [
          {
            result: {
              status: params[0] === USER_A ? 'reviewed' : 'already_reviewed'
            }
          }
        ]
      };
    }
  });
  const result = await runner.reviewDue({ limit: 2 });
  assert.deepEqual(result, {
    status: 'review_tick_completed',
    reviewed: 1,
    alreadyReviewed: 1,
    held: 0
  });
  assert.equal(calls.length, 3);
  assert.match(
    calls[0].sql,
    /^select user_id from novelight_formal_private.scout_level_state /
  );
  assert.deepEqual(calls[0].params, [CLOCK, 2]);
  assert.match(
    calls[1].sql,
    /^select novelight_formal_private.review_scout_30_days\(\$1::uuid,\$2::timestamptz\)/
  );
  assert.deepEqual(calls[1].params, [USER_A, CLOCK]);
  assert.deepEqual(calls[2].params, [USER_B, CLOCK]);
});

test('adjusted XP remains held without claiming a demotion', async () => {
  let executions = 0;
  const runner = make({
    query: async (sql) => {
      if (sql.includes('from novelight_formal_private.scout_level_state'))
        return { rows: [{ user_id: USER_A }] };
      executions++;
      return { rows: [{ result: { status: 'adjustment_policy_pending' } }] };
    }
  });
  assert.deepEqual(await runner.reviewDue(), {
    status: 'review_tick_completed',
    reviewed: 0,
    alreadyReviewed: 0,
    held: 1
  });
  assert.equal(executions, 1);
});

test('invalid limits, time and due identities cannot execute review SQL', async () => {
  let calls = 0;
  const client = {
    query: async () => {
      calls++;
      return { rows: [] };
    }
  };
  const runner = make(client);
  for (const limit of [0, 26, -1, '10', 1.5]) {
    assert.equal(
      (await runner.reviewDue({ limit })).status,
      'invalid_review_limit'
    );
  }
  assert.equal(
    (await make(client, { now: () => new Date('invalid') }).reviewDue()).status,
    'review_clock_unavailable'
  );
  assert.equal(calls, 0);
  for (const due of [
    [{ user_id: 'not-uuid' }],
    [{ user_id: USER_A }, { user_id: USER_A }],
    [{ user_id: USER_A }, { user_id: USER_B }]
  ]) {
    let reviewCalls = 0;
    const invalid = make({
      query: async (sql) => {
        if (sql.includes('from novelight_formal_private.scout_level_state'))
          return { rows: due };
        reviewCalls++;
        return { rows: [{ result: { status: 'reviewed' } }] };
      }
    });
    const result = await invalid.reviewDue({
      limit: due.length === 2 ? 1 : 10
    });
    assert.equal(result.status, 'review_source_invalid');
    assert.equal(reviewCalls, 0);
  }
});

test('invalid review result or DB failure is held without exposing identities', async () => {
  const invalid = make({
    query: async (sql) =>
      sql.includes('from novelight_formal_private.scout_level_state')
        ? { rows: [{ user_id: USER_A }] }
        : { rows: [{ result: { status: 'unknown' } }] }
  });
  assert.equal(
    (await invalid.reviewDue()).status,
    'review_result_requires_attention'
  );
  const failed = make({
    query: async () => {
      throw Error('secret database token');
    }
  });
  const failure = await failed.reviewDue();
  assert.equal(failure.status, 'review_db_unavailable');
  assert.equal(JSON.stringify(failure).includes('secret'), false);
});

test('single runner cannot overlap itself, and only injected existing scheduler can bind', async () => {
  let finish;
  let queryCount = 0;
  const runner = make({
    query: async () => {
      queryCount++;
      await new Promise((resolve) => {
        finish = resolve;
      });
      return { rows: [] };
    }
  });
  assert.equal(
    runner.bindExistingScheduler({}).status,
    'review_scheduler_binding_invalid'
  );
  assert.equal(
    runner.bindExistingScheduler({ registerTick: () => {}, limit: 26 }).status,
    'review_scheduler_binding_invalid'
  );
  let task;
  let registered = 0;
  let unregistered = 0;
  const binding = runner.bindExistingScheduler({
    limit: 1,
    registerTick(entry) {
      registered++;
      task = entry;
      return {
        unregister() {
          unregistered++;
        }
      };
    }
  });
  assert.equal(binding.status, 'review_scheduler_bound');
  assert.equal(registered, 1);
  assert.equal(task.taskKey, 'novelight-formal-maintenance-30d');
  const first = task.run();
  await Promise.resolve();
  assert.equal((await task.run()).status, 'review_tick_already_running');
  finish();
  assert.equal((await first).status, 'review_tick_completed');
  assert.equal(queryCount, 1);
  binding.unregister();
  assert.equal(unregistered, 1);
});
