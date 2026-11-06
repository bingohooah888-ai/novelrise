import test from 'node:test';
import assert from 'node:assert/strict';
import { planR2ReservationOffline } from '../api/_lib/ai/r2-cost-guard-reservation-plan.js';

const now = Date.parse('2026-11-06T12:00:00Z');
const billingPeriodStart = '2026-11-06T00:00:00.000Z';
const billingPeriodEnd = '2026-12-06T00:00:00.000Z';
const observedAt = '2026-11-06T11:59:00.000Z';

function snapshot({
  usage = {},
  accounting = {},
  enforcement = {},
  ...rest
} = {}) {
  return {
    source: 'cloudflare-r2-account',
    scope: 'account',
    storageClass: 'STANDARD',
    billingPeriodStart,
    billingPeriodEnd,
    observedAt,
    usage: {
      storageGbMonth: 0.1,
      classAOperations: 1000,
      classBOperations: 5000,
      ...usage
    },
    storageAccounting: {
      mode: 'accrued-standard-gb-month',
      measuredAt: observedAt,
      allAccountBucketsCovered: true,
      currentStandardStoredBytes: 1_000_000_000,
      ...accounting
    },
    enforcement: {
      allAccountR2OperationsCovered: true,
      durableAtomicStopVerified: true,
      state: 'running',
      ...enforcement
    },
    ...rest
  };
}

const pendingReservations = Object.freeze({
  classAOperations: 0,
  classBOperations: 0,
  newStoredBytes: 0
});

function plan({
  s = snapshot(),
  intent = { action: 'PutObject', operationCount: 1, newStoredBytes: 1000 },
  pending = pendingReservations,
  at = now
} = {}) {
  return planR2ReservationOffline({
    snapshot: s,
    intent,
    pendingReservations: pending,
    now: at
  });
}

test('a normal write is ONLY eligible to be reserved atomically', () => {
  const p = plan();
  assert.equal(p.state, 'eligible-for-atomic-reservation');
  assert.equal(p.mayExecute, false);
  assert.equal(p.requiresAtomicReservation, true);
  assert.equal(p.reservation.classAOperations, 1);
  assert.equal(p.reservation.classBOperations, 0);
  assert.equal(p.reservation.newStoredBytes, 1000);
});

test('R2 reads still require a reservation for Class B operations', () => {
  for (const action of ['GetObject', 'HeadObject']) {
    const p = plan({
      intent: { action, operationCount: 2, newStoredBytes: 0 }
    });
    assert.equal(p.state, 'eligible-for-atomic-reservation');
    assert.equal(p.reservation.classBOperations, 2);
    assert.equal(p.mayExecute, false);
  }
});

test('ListObjects uses Class A despite being non-mutating', () => {
  const p = plan({
    intent: { action: 'ListObjects', operationCount: 3, newStoredBytes: 0 }
  });
  assert.equal(p.reservation.classAOperations, 3);
});

test('only allowlisted R2 actions are accepted', () => {
  for (const action of ['DeleteObject', 'CopyObject', 'Unknown', '', null]) {
    assert.equal(
      plan({ intent: { action, operationCount: 1, newStoredBytes: 0 } }).state,
      'denied'
    );
  }
});

test('unbounded counts and invalid write payloads deny fail-closed', () => {
  for (const count of [0, -1, 1.5, 1025, Infinity, '1', null]) {
    assert.equal(
      plan({
        intent: {
          action: 'GetObject',
          operationCount: count,
          newStoredBytes: 0
        }
      }).state,
      'denied'
    );
  }
  assert.equal(
    plan({
      intent: { action: 'PutObject', operationCount: 1, newStoredBytes: 0 }
    }).state,
    'denied'
  );
  assert.equal(
    plan({
      intent: { action: 'GetObject', operationCount: 1, newStoredBytes: 1 }
    }).state,
    'denied'
  );
});

test('near-90% Class A or B consumption prevents new reservations', () => {
  const pA = plan({
    s: snapshot({ usage: { classAOperations: 899999 } })
  });
  assert.equal(pA.reason, 'R2_FORECAST_OR_RESERVATION_CAP_REACHED');
  const pB = plan({
    s: snapshot({ usage: { classBOperations: 8_999_999 } }),
    intent: { action: 'GetObject', operationCount: 1, newStoredBytes: 0 }
  });
  assert.equal(pB.reason, 'R2_FORECAST_OR_RESERVATION_CAP_REACHED');
});

test('existing pending reservations count against next operation', () => {
  const p = plan({
    s: snapshot({ usage: { classAOperations: 800000 } }),
    pending: {
      classAOperations: 100000,
      classBOperations: 0,
      newStoredBytes: 0
    }
  });
  assert.equal(p.state, 'denied');
});

test('storage forecast includes existing objects and pending added bytes', () => {
  const p = plan({
    s: snapshot({
      usage: { storageGbMonth: 2 },
      accounting: { currentStandardStoredBytes: 6_000_000_000 }
    }),
    pending: {
      classAOperations: 0,
      classBOperations: 0,
      newStoredBytes: 2_000_000_000
    }
  });
  assert.equal(p.reason, 'R2_FORECAST_OR_RESERVATION_CAP_REACHED');
});

test('missing account-wide storage evidence or pending ledger denies', () => {
  const checks = [
    { accounting: { allAccountBucketsCovered: false } },
    { accounting: { currentStandardStoredBytes: null } },
    { accounting: { mode: 'snapshot-instant-bytes' } },
    { accounting: { measuredAt: '2026-11-05T00:00:00Z' } }
  ];
  for (const fields of checks) {
    const p = plan({ s: snapshot(fields) });
    assert.equal(p.reason, 'R2_STORAGE_ACCOUNTING_UNVERIFIED');
  }
  assert.equal(
    plan({ pending: null }).reason,
    'R2_RESERVATION_LEDGER_UNVERIFIED'
  );
  assert.equal(plan({ pending: { classAOperations: 0 } }).state, 'denied');
});

test('stale provider snapshots and unverified stop implementation deny', () => {
  assert.equal(
    plan({
      s: snapshot({ observedAt: '2026-11-05T11:00:00Z' })
    }).reason,
    'R2_GUARD_DENIED_OR_UNVERIFIED'
  );
  assert.equal(
    plan({
      s: snapshot({ enforcement: { durableAtomicStopVerified: false } })
    }).reason,
    'R2_GUARD_DENIED_OR_UNVERIFIED'
  );
  assert.equal(
    plan({
      s: snapshot({ enforcement: { state: 'stopped' } })
    }).reason,
    'R2_GUARD_DENIED_OR_UNVERIFIED'
  );
});

test('an expired billing period never admits a request', () => {
  const p = plan({
    s: snapshot({ billingPeriodEnd: '2026-11-06T10:00:00Z' })
  });
  assert.equal(p.state, 'denied');
  assert.equal(p.mayExecute, false);
});

test('all offline results deny direct execution, including below 70%', () => {
  const cases = [
    plan(),
    plan({ s: snapshot({ usage: { classAOperations: 750000 } }) }),
    plan({ s: snapshot({ usage: { classBOperations: 8_500_000 } }) }),
    plan({ s: null })
  ];
  for (const p of cases) {
    assert.equal(p.mayExecute, false);
    assert.equal(p.requiresAtomicReservation, true);
  }
});
