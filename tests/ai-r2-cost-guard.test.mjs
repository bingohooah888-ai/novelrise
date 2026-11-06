import test from 'node:test';
import assert from 'node:assert/strict';
import {
  R2_FREE_ALLOWANCE,
  evaluateR2CostGuard,
  costGuardDisplay
} from '../api/_lib/ai/r2-cost-guard.js';
import { loadR2CostGuardStatus } from '../api/_lib/ai/r2-cost-guard-status.js';

const now = Date.parse('2026-11-06T11:00:00.000Z');
const endpoint =
  'https://novelight-ai-gateb.example.workers.dev/internal/novelight-cost-guard/status';
const token = 'test-only-token-value-1234567890-abcdef';

function snapshot(overrides = {}) {
  return {
    source: 'cloudflare-r2-account',
    scope: 'account',
    storageClass: 'STANDARD',
    billingPeriodStart: '2026-11-01T00:00:00.000Z',
    billingPeriodEnd: '2026-12-01T00:00:00.000Z',
    observedAt: '2026-11-06T10:59:00.000Z',
    usage: {
      storageGbMonth: 0.5,
      classAOperations: 10_000,
      classBOperations: 20_000
    },
    enforcement: {
      allAccountR2OperationsCovered: true,
      durableAtomicStopVerified: true,
      state: 'running'
    },
    ...overrides
  };
}

function evaluate(usage, other = {}) {
  return evaluateR2CostGuard(snapshot({ usage, ...other }), { now });
}

test('monthly allowances use GB-month, Class A and Class B independently', () => {
  assert.equal(R2_FREE_ALLOWANCE.storageGbMonth, 10);
  assert.equal(R2_FREE_ALLOWANCE.classAOperations, 1_000_000);
  assert.equal(R2_FREE_ALLOWANCE.classBOperations, 10_000_000);
  const decision = evaluateR2CostGuard(snapshot(), { now });
  assert.equal(decision.state, 'normal');
  assert.equal(decision.admissionPermitted, false);
  assert.equal(decision.stopConfirmed, false);
});

test('70%, 85% and 90% boundaries are inclusive', () => {
  for (const [fraction, expected] of [
    [0.699, 'normal'],
    [0.7, 'notice'],
    [0.85, 'urgent'],
    [0.9, 'stop-required'],
    [1.0, 'stop-required']
  ]) {
    const decision = evaluate({
      storageGbMonth: 10 * fraction,
      classAOperations: 0,
      classBOperations: 0
    });
    assert.equal(decision.state, expected);
    assert.equal(decision.admissionPermitted, false);
    assert.equal(decision.limitingMetric, 'storageGbMonth');
  }
});

test('each operation class independently trips the stop boundary', () => {
  for (const field of ['classAOperations', 'classBOperations']) {
    const usage = {
      storageGbMonth: 0,
      classAOperations: 0,
      classBOperations: 0
    };
    usage[field] = Math.round(R2_FREE_ALLOWANCE[field] * 0.9);
    const decision = evaluate(usage);
    assert.equal(decision.state, 'stop-required');
    assert.equal(decision.limitingMetric, field);
  }
});

test('verified persisted stop never automatically reopens on usage reset', () => {
  const decision = evaluateR2CostGuard(
    snapshot({
      usage: {
        storageGbMonth: 0,
        classAOperations: 0,
        classBOperations: 0
      },
      enforcement: {
        allAccountR2OperationsCovered: true,
        durableAtomicStopVerified: true,
        state: 'stopped'
      }
    }),
    { now }
  );
  assert.equal(decision.state, 'stopped');
  assert.equal(decision.stopRequired, true);
  assert.equal(decision.stopConfirmed, true);
  assert.equal(decision.admissionPermitted, false);
});

test('90% with a running gate must say stop not confirmed', () => {
  const result = evaluate({
    storageGbMonth: 9,
    classAOperations: 0,
    classBOperations: 0
  });
  assert.equal(result.state, 'stop-required');
  assert.equal(result.stopConfirmed, false);
  assert.match(costGuardDisplay(result).title, /停止未確認/);
});

test('absent, stale and future measurements fail closed', () => {
  assert.equal(evaluateR2CostGuard(null, { now }).state, 'unverified');
  for (const observedAt of [
    '2026-11-06T10:20:00Z',
    '2026-11-06T11:02:00Z',
    'invalid'
  ]) {
    const result = evaluateR2CostGuard(snapshot({ observedAt }), { now });
    assert.equal(result.admissionPermitted, false);
    assert.equal(result.severity, 'critical');
  }
});

test('unknown storage class, outside billing period, and partial account coverage fail closed', () => {
  const invalid = [
    { storageClass: 'INFREQUENT_ACCESS' },
    { scope: 'bucket' },
    { source: 'client-counter' },
    { billingPeriodEnd: '2026-11-05T00:00:00Z' },
    {
      enforcement: {
        state: 'running',
        allAccountR2OperationsCovered: false,
        durableAtomicStopVerified: true
      }
    },
    {
      enforcement: {
        state: 'running',
        allAccountR2OperationsCovered: true,
        durableAtomicStopVerified: false
      }
    }
  ];
  for (const fields of invalid) {
    assert.equal(
      evaluateR2CostGuard(snapshot(fields), { now }).state,
      'unverified'
    );
  }
});

test('invalid numeric counters do not convert to an apparently safe zero', () => {
  for (const broken of [undefined, null, '1', -1, NaN, Infinity]) {
    const result = evaluate({
      storageGbMonth: broken,
      classAOperations: 0,
      classBOperations: 0
    });
    assert.equal(result.admissionPermitted, false);
  }
  const fractional = evaluate({
    storageGbMonth: 0,
    classAOperations: 1.5,
    classBOperations: 0
  });
  assert.equal(fractional.state, 'unverified');
});

test('status endpoint is unconfigured by default and never claims monitoring', async () => {
  const result = await loadR2CostGuardStatus({ env: {}, now });
  assert.equal(result.state, 'not-configured');
  assert.equal(result.admissionPermitted, false);
  assert.match(result.detail, /未有効/);
});

test('invalid endpoint cannot trigger an internal-network fetch', async () => {
  let called = false;
  const result = await loadR2CostGuardStatus({
    env: {
      NOVELIGHT_CF_R2_COST_GUARD_STATUS_URL:
        'http://127.0.0.1:5000/internal/novelight-cost-guard/status',
      NOVELIGHT_CF_R2_COST_GUARD_STATUS_TOKEN: token
    },
    now,
    fetchImpl: async () => {
      called = true;
      throw new Error('unexpected call');
    }
  });
  assert.equal(called, false);
  assert.equal(result.state, 'unverified');
});

test('authenticated status requests use no-store, no redirect, never expose secrets', async () => {
  const response = await loadR2CostGuardStatus({
    env: {
      NOVELIGHT_CF_R2_COST_GUARD_STATUS_URL: endpoint,
      NOVELIGHT_CF_R2_COST_GUARD_STATUS_TOKEN: token
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, endpoint);
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'error');
      return new globalThis.Response(JSON.stringify(snapshot()), {
        status: 200
      });
    },
    now
  });
  assert.equal(response.state, 'normal');
  assert.equal(response.admissionPermitted, false);
  assert.equal(JSON.stringify(response).includes(token), false);
});

test('HTTP error and invalid provider response are surfaced as unverified', async () => {
  const env = {
    NOVELIGHT_CF_R2_COST_GUARD_STATUS_URL: endpoint,
    NOVELIGHT_CF_R2_COST_GUARD_STATUS_TOKEN: token
  };
  for (const fetchImpl of [
    async () => new globalThis.Response('Access denied', { status: 403 }),
    async () => new globalThis.Response('not json', { status: 200 }),
    async () => {
      throw new Error('failed');
    }
  ]) {
    const result = await loadR2CostGuardStatus({ env, now, fetchImpl });
    assert.equal(result.state, 'unverified');
    assert.equal(result.admissionPermitted, false);
  }
});
