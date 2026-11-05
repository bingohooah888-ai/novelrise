import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exploreScoutReservationInterleavings,
  exploreScoutCrashCutpoints,
  exploreScoutWebhookPermutations
} from '../api/_lib/reader-reward/state-space-simulation.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const wallet = (availablePoints = 50000) => ({
  userId: USER,
  availablePoints,
  reservedPoints: 0,
  revision: 0
});
const budget = (limitPoints = 100000) => ({
  scopeId: 'private-model-budget',
  limitPoints,
  committedPoints: 0,
  reservedPoints: 0,
  revision: 0
});
const operation = (
  operationId,
  amountPoints = 30000,
  purpose = 'external_exchange'
) => ({
  userId: USER,
  operationId,
  purpose,
  amountPoints,
  phase: 'new',
  revision: 0
});
const payloads = [
  { providerRoute: 'simulated_route', payloadDigest: DIGEST_A },
  { providerRoute: 'simulated_route', payloadDigest: DIGEST_B }
];
const race = (overrides = {}) =>
  exploreScoutReservationInterleavings({
    walletSnapshot: wallet(),
    budgetSnapshot: budget(),
    operations: [operation(A), operation(B)],
    payloads,
    ...overrides
  });
const outbox = (operationId = A) => ({
  operationKey: 'scout-point-use-v1:' + USER + ':' + operationId,
  providerRoute: 'simulated_route',
  payloadDigest: DIGEST_A,
  purpose: 'external_exchange',
  amountPoints: 30000,
  status: 'queued',
  revision: 0
});
const reserved = (operationId = A) => ({
  ...operation(operationId),
  phase: 'reserved',
  revision: 1
});
const notification = (eventId, outcome, transactionId = 'provider_tx_001') => ({
  eventId,
  outcome,
  transactionId,
  operationKey: outbox().operationKey,
  providerRoute: 'simulated_route',
  payloadDigest: DIGEST_A
});
const webhook = (events, overrides = {}) =>
  exploreScoutWebhookPermutations({
    operation: reserved(),
    outbox: outbox(),
    events,
    ...overrides
  });
const crash = (overrides = {}) =>
  exploreScoutCrashCutpoints({
    operation: reserved(),
    outbox: outbox(),
    ...overrides
  });
const invariant = (model) => {
  for (const scenario of model.scenarios) {
    for (const [name, passed] of Object.entries(scenario.invariant)) {
      assert.equal(passed, true, name + ' for ' + scenario.order.join(','));
    }
  }
};
const traceCount = (scenario, status) =>
  scenario.traces.filter((entry) => entry.status === status).length;

test('all six relative orderings for two concurrent reservation requests are enumerated', () => {
  const result = race();
  assert.equal(result.scheduleCount, 6);
  assert.equal(result.scenarios.length, 6);
  assert.equal(new Set(result.scenarios.map((x) => x.order.join('|'))).size, 6);
});

test('race checker is a pure, nonexecuting design analysis', () => {
  const result = race();
  assert.equal(result.status, 'bounded_mock_model_only');
  assert.equal(result.mayConnectDb, false);
  assert.equal(result.mayInvokeProvider, false);
  assert.equal(result.mayMovePointsOrMoney, false);
});

test('wallet cannot be overdrawn in any interleaving of two 3000pt requests', () => {
  const result = race();
  invariant(result);
  for (const scenario of result.scenarios) {
    assert.equal(scenario.wallet.availablePoints, 20000);
    assert.equal(scenario.wallet.reservedPoints, 30000);
    assert.equal(scenario.outboxes.filter(Boolean).length, 1);
  }
});

test('stale snapshot is rejected on a simultaneous begin-before-finish schedule', () => {
  const result = race();
  const stale = result.scenarios.filter((s) =>
    s.traces.some((event) => event.status === 'stale_snapshot_rejected')
  );
  assert.equal(stale.length, 4);
  assert.ok(
    stale.every((s) => traceCount(s, 'virtual_reservation_only') === 1)
  );
});

test('sequential quote after first reservation rechecks insufficient funds', () => {
  const result = race();
  const sequential = result.scenarios.filter(
    (s) =>
      s.order.join('|') === 'begin:0|finish:0|begin:1|finish:1' ||
      s.order.join('|') === 'begin:1|finish:1|begin:0|finish:0'
  );
  assert.equal(sequential.length, 2);
  for (const scenario of sequential) {
    assert.equal(traceCount(scenario, 'insufficient_eligible_points'), 1);
    assert.equal(traceCount(scenario, 'not_quoted_noop'), 1);
  }
});

test('an approved virtual budget below demand blocks the second reservation', () => {
  const result = race({
    walletSnapshot: wallet(90000),
    budgetSnapshot: budget(50000)
  });
  invariant(result);
  for (const scenario of result.scenarios) {
    assert.equal(scenario.wallet.reservedPoints, 30000);
    assert.equal(scenario.budget.reservedPoints, 30000);
    assert.equal(scenario.budget.committedPoints, 0);
  }
});

test('both 3000pt operations can reserve only when sequenced with sufficient balance', () => {
  const result = race({ walletSnapshot: wallet(80000) });
  invariant(result);
  const two = result.scenarios.filter((s) => s.wallet.reservedPoints === 60000);
  assert.equal(two.length, 2);
  assert.ok(two.every((s) => s.outboxes.filter(Boolean).length === 2));
});

test('simultaneous quotations do not both pass stale revisions with enough money', () => {
  const result = race({ walletSnapshot: wallet(80000) });
  invariant(result);
  assert.equal(
    result.scenarios.filter((s) =>
      s.traces.some((entry) => entry.status === 'stale_snapshot_rejected')
    ).length,
    4
  );
});

test('different operation purposes consume the same virtual wallet and budget', () => {
  const result = race({
    operations: [
      operation(A, 30000, 'external_exchange'),
      operation(B, 25000, 'ai_direct_use')
    ]
  });
  invariant(result);
  assert.ok(
    result.scenarios.every(
      (s) =>
        s.wallet.reservedPoints === 30000 || s.wallet.reservedPoints === 25000
    )
  );
});

test('AI can be tested with a 1pt fixture without setting any actual AI price', () => {
  const result = race({
    walletSnapshot: wallet(40000),
    operations: [
      operation(A, 30000, 'external_exchange'),
      operation(B, 1, 'ai_direct_use')
    ]
  });
  invariant(result);
  const sequential = result.scenarios.filter(
    (s) => s.wallet.reservedPoints === 30001
  );
  assert.equal(sequential.length, 2);
});

test('mock external exchange below the existing 3000pt floor is not reserved', () => {
  const result = race({
    operations: [
      operation(A, 29990, 'external_exchange'),
      operation(B, 30000, 'external_exchange')
    ]
  });
  invariant(result);
  assert.ok(
    result.scenarios.every(
      (s) =>
        s.operationStates[0].phase === 'new' &&
        s.operationStates[1].phase === 'reserved'
    )
  );
});

test('conservation law and approved budget apply across a bounded numeric grid', () => {
  for (const available of [0, 1, 30000, 30010, 50000, 60000, 90000]) {
    for (const limit of [0, 29990, 30000, 50000, 60000, 90000]) {
      const result = race({
        walletSnapshot: wallet(available),
        budgetSnapshot: budget(limit)
      });
      invariant(result);
      assert.equal(result.scheduleCount, 6);
    }
  }
});

test('reserving with 0 wallet or 0 budget never produces an outbox', () => {
  for (const settings of [
    { walletSnapshot: wallet(0) },
    { budgetSnapshot: budget(0) }
  ]) {
    const result = race(settings);
    assert.ok(
      result.scenarios.every((s) => s.outboxes.every((x) => x === null))
    );
  }
});

test('reject duplicate operation IDs in the bounded model', () => {
  assert.throws(
    () => race({ operations: [operation(A), operation(A)] }),
    TypeError
  );
});

test('reject requests for another user before simulating any wallet operation', () => {
  assert.throws(
    () =>
      race({
        operations: [
          operation(A),
          { ...operation(B), userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
        ]
      }),
    TypeError
  );
});

test('reject missing outbox payloads or nonzero preexisting reservations', () => {
  assert.throws(() => race({ payloads: [] }), TypeError);
  assert.throws(
    () => race({ walletSnapshot: { ...wallet(), reservedPoints: 1 } }),
    TypeError
  );
});

test('crash model enumerates 5 phases × 5 outbox states × 8 persistence combinations', () => {
  const result = crash();
  assert.equal(result.status, 'bounded_mock_model_only');
  assert.equal(result.caseCount, 200);
  assert.equal(result.cases.length, 200);
});

test('no crash case invokes a provider, modifies a DB or moves real points', () => {
  const result = crash();
  assert.equal(result.mayInvokeProvider, false);
  assert.equal(result.mayConnectDb, false);
  assert.equal(result.mayMovePointsOrMoney, false);
  for (const c of result.cases) {
    assert.equal(c.noProviderReplay, true);
    assert.equal(c.noDbWrite, true);
    assert.equal(c.noPointMovement, true);
  }
});

test('six of eight durability masks are rejected as inconsistent atomic persistence', () => {
  const result = crash();
  for (const phase of [
    'new',
    'reserved',
    'committed',
    'released',
    'refunded'
  ]) {
    for (const status of [
      'queued',
      'leased',
      'uncertain',
      'delivered',
      'cancelled'
    ]) {
      const subset = result.cases.filter(
        (c) => c.phase === phase && c.outboxStatus === status
      );
      const broken = subset.filter(
        (c) => c.status === 'atomicity_invariant_breach_manual_hold'
      );
      assert.equal(broken.length, 6, phase + '/' + status);
    }
  }
});

test('a crash before durable reservation always has no provider intent', () => {
  assert.ok(
    crash()
      .cases.filter((c) => c.durabilityMask === 0)
      .every((c) => c.status === 'no_durable_intent_no_external_call')
  );
});

test('an outbox queued with a durable reservation only permits review', () => {
  const subset = crash().cases.filter(
    (c) =>
      c.phase === 'reserved' &&
      c.outboxStatus === 'queued' &&
      c.durabilityMask === 7
  );
  assert.equal(subset.length, 1);
  assert.equal(subset[0].status, 'queued_needs_authoritative_dispatch_review');
});

test('leased, unknown, delivered and cancelled cannot trigger replay', () => {
  const subset = crash().cases.filter(
    (c) =>
      c.phase === 'reserved' &&
      c.durabilityMask === 7 &&
      c.outboxStatus !== 'queued'
  );
  assert.equal(subset.length, 4);
  assert.ok(
    subset.every((c) => c.status === 'provider_unknown_hold_reconcile')
  );
});

test('a confirmed operation is reconciled rather than calling its provider again', () => {
  assert.ok(
    crash()
      .cases.filter((c) => c.phase === 'committed' && c.durabilityMask === 7)
      .every((c) => c.status === 'committed_verify_ledger_no_replay')
  );
});

test('released and refunded operations stay terminal under all durable outbox states', () => {
  assert.ok(
    crash()
      .cases.filter(
        (c) =>
          (c.phase === 'released' || c.phase === 'refunded') &&
          c.durabilityMask === 7
      )
      .every((c) => c.status === 'terminal_noop')
  );
});

test('a new operation with a durable outbox is held for phase conflict', () => {
  assert.ok(
    crash()
      .cases.filter((c) => c.phase === 'new' && c.durabilityMask === 7)
      .every((c) => c.status === 'phase_conflict_manual_hold')
  );
});

test('webhook model enumerates all 3! callback arrival orders', () => {
  const result = webhook([
    notification('evt_a', 'pending'),
    notification('evt_b', 'succeeded'),
    notification('evt_c', 'succeeded')
  ]);
  assert.equal(result.caseCount, 6);
  assert.equal(new Set(result.cases.map((x) => x.order.join('|'))).size, 6);
});

test('duplicate successful receipt cannot generate a fresh candidate after first receipt', () => {
  const event = notification('evt_dup', 'succeeded');
  const result = webhook([event, { ...event }]);
  for (const scenario of result.cases) {
    assert.deepEqual(
      scenario.steps.map((x) => x.status),
      ['commit_candidate_only', 'duplicate_notification_noop']
    );
    assert.equal(scenario.manualHold, false);
  }
});

test('two different event IDs for one provider transaction are reconciled', () => {
  const result = webhook([
    notification('evt_a', 'succeeded', 'provider_tx_001'),
    notification('evt_b', 'succeeded', 'provider_tx_001')
  ]);
  assert.ok(
    result.cases.every(
      (c) =>
        c.steps[0].status === 'commit_candidate_only' &&
        c.steps[1].status === 'same_provider_transaction_reconcile'
    )
  );
});

test('distinct successful provider transaction IDs for one operation cause manual hold', () => {
  const result = webhook([
    notification('evt_a', 'succeeded', 'provider_tx_001'),
    notification('evt_b', 'succeeded', 'provider_tx_002')
  ]);
  assert.ok(result.cases.every((c) => c.manualHold));
  assert.ok(
    result.cases.every((c) =>
      c.steps.some(
        (step) => step.status === 'distinct_provider_transactions_manual_hold'
      )
    )
  );
});

test('success and definitive failure for the same operation cause manual hold regardless of arrival order', () => {
  const result = webhook([
    notification('evt_success', 'succeeded'),
    notification('evt_failed', 'failed', 'provider_tx_001')
  ]);
  assert.equal(result.caseCount, 2);
  assert.ok(result.cases.every((c) => c.manualHold));
  assert.ok(
    result.cases.every((c) =>
      c.steps.some(
        (s) => s.status === 'contradictory_terminal_receipts_manual_hold'
      )
    )
  );
});

test('pending followed by success remains a candidate, not actual settlement', () => {
  const result = webhook([
    notification('evt_pending', 'pending'),
    notification('evt_success', 'succeeded')
  ]);
  assert.ok(result.cases.every((c) => !c.manualHold));
  assert.ok(
    result.cases.every((c) =>
      c.steps.some((s) => s.status === 'commit_candidate_only')
    )
  );
  assert.ok(
    result.cases.every(
      (c) => c.mayMovePointsOrMoney === false && c.mayInvokeProvider === false
    )
  );
});

test('partial fulfillment is never accepted as completed exchange or AI use', () => {
  const result = webhook([
    notification('evt_a', 'partial'),
    notification('evt_b', 'pending')
  ]);
  assert.ok(
    result.cases.every((c) =>
      c.steps.some(
        (step) => step.status === 'partial_fulfillment_manual_review'
      )
    )
  );
});

test('different callbacks with conflicting reuse of event ID stop processing', () => {
  const result = webhook([
    notification('evt_same', 'pending'),
    notification('evt_same', 'succeeded')
  ]);
  assert.ok(
    result.cases.every(
      (c) => c.steps[1].status === 'event_id_collision_hold' && c.manualHold
    )
  );
});

test('webhook exploration never calls the provider, writes a DB or issues points', () => {
  const result = webhook([
    notification('evt_a', 'succeeded'),
    notification('evt_b', 'pending'),
    notification('evt_c', 'succeeded'),
    notification('evt_d', 'partial')
  ]);
  assert.equal(result.caseCount, 24);
  assert.ok(
    result.cases.every(
      (c) =>
        c.mayInvokeProvider === false &&
        c.mayConnectDb === false &&
        c.mayMovePointsOrMoney === false
    )
  );
});

test('cannot search unlimited callback sets; intentionally bounded to 4 events', () => {
  assert.throws(() => webhook([]), TypeError);
  assert.throws(
    () =>
      webhook([
        notification('evt_1', 'pending'),
        notification('evt_2', 'pending'),
        notification('evt_3', 'pending'),
        notification('evt_4', 'pending'),
        notification('evt_5', 'pending')
      ]),
    TypeError
  );
});

test('all distinct candidate commit keys remain stable across reordered notifications', () => {
  const result = webhook([
    notification('evt_1', 'succeeded'),
    notification('evt_2', 'succeeded'),
    notification('evt_3', 'pending')
  ]);
  for (const scenario of result.cases) {
    const keys = scenario.steps
      .map((x) => x.suggestedLedgerKey)
      .filter(Boolean);
    assert.ok(keys.every((key) => key === outbox().operationKey + ':commit'));
  }
});
