// Gate 10: bounded, deterministic MODEL CHECKS over Gate07-09 quotes.
// These fixtures are NOT authoritative evidence, a durable outbox, or DB locks.
// No DB connection, provider network, payments, AI execution, or state mutation.
import {
  quoteScoutPointOperation,
  recheckScoutPointOperation
} from './point-settlement.js';
import { quoteScoutPointAtomicConnection } from './atomic-connection-plan.js';
import {
  quoteScoutProviderOutboxEnqueue,
  quoteScoutProviderNotification,
  quoteScoutOutboxCrashRecovery
} from './provider-outbox-simulation.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const safe = (v) => Number.isSafeInteger(v) && v >= 0;
const frozen = (v) => Object.freeze(v);
const disabled = frozen({
  mayConnectDb: false,
  mayMovePointsOrMoney: false,
  mayInvokeProvider: false
});
const proof = frozen({
  authoritativeStateVerified: true,
  budgetPolicyApproved: true,
  pointEligibilityVerified: true,
  riskAndControlsCleared: true,
  operationUniquenessVerified: true,
  channelPolicyApproved: true,
  aiPriceApproved: true,
  fulfillmentVerified: true,
  failureOrCancellationVerified: true,
  noFulfillmentVerified: true,
  refundProofVerified: true,
  originalSettlementVerified: true,
  externalFundsRecoveryVerified: true
});
const guards = frozen({
  trustedServerPrincipal: true,
  fullLedgerReconciliation: true,
  pointEligibilityPolicyApproved: true,
  identityAndRiskCleared: true,
  budgetPolicyApproved: true,
  singleTransactionGuaranteed: true,
  sharedWalletLockAndCas: true,
  budgetLockAndCas: true,
  durableOperationClaimUnique: true,
  operationRevisionCas: true,
  eventKeyUniqueAndReversalSafe: true,
  atomicAuditAndOutbox: true,
  legacyPointPathsSerialized: true
});
const enqueueEvidence = frozen({
  serverIdentityVerified: true,
  reservationClaimAndLedgerVerified: true,
  atomicOutboxWithReservationVerified: true,
  authorizedBudgetAndPointEligibility: true,
  riskAndIdentityCleared: true,
  providerRouteAndIdempotencyContractVerified: true,
  immutablePayloadBoundToApprovedTerms: true,
  privateOutboxAndAuditVerified: true,
  aiPriceApproved: true
});
const callbackEvidence = frozen({
  trustedAuthenticatedProvider: true,
  receiptSignatureAndRouteVerified: true,
  completeNotificationHistoryVerified: true,
  authoritativeProviderStatusQueried: true,
  operationLedgerAndBudgetCasVerified: true,
  fulfillmentProofVerified: true,
  noExternalFulfillmentProven: true,
  definitiveProviderFailureVerified: true
});

/**
 * Enumerate every 2-operation request/commit interleaving (6 schedules).
 * Only Gate07's existing quote/recheck decides wallet and budget changes.
 * Snapshots evolve ONLY in an ephemeral JS object. Gate08/09 are invoked
 * for design-bound outbox proposals; no real transaction is attempted.
 */
export function exploreScoutReservationInterleavings({
  walletSnapshot,
  budgetSnapshot,
  operations,
  payloads
}) {
  if (
    !object(walletSnapshot) ||
    !object(budgetSnapshot) ||
    !Array.isArray(operations) ||
    operations.length !== 2 ||
    !Array.isArray(payloads) ||
    payloads.length !== 2 ||
    operations.some(
      (op) =>
        !object(op) ||
        op.phase !== 'new' ||
        op.userId !== walletSnapshot.userId ||
        !safe(op.amountPoints) ||
        op.amountPoints === 0
    ) ||
    operations[0].operationId === operations[1].operationId ||
    !safe(walletSnapshot.availablePoints) ||
    !safe(walletSnapshot.reservedPoints) ||
    !safe(budgetSnapshot.limitPoints) ||
    !safe(budgetSnapshot.committedPoints) ||
    !safe(budgetSnapshot.reservedPoints)
  ) {
    throw new TypeError(
      'Exactly two distinct, same-wallet mock requests are required'
    );
  }
  if (
    walletSnapshot.reservedPoints !== 0 ||
    budgetSnapshot.reservedPoints !== 0
  ) {
    throw new TypeError(
      'This bounded model starts with zero existing reservations'
    );
  }
  const actions = [
    ['begin', 0],
    ['finish', 0],
    ['begin', 1],
    ['finish', 1]
  ];
  const schedules = [];
  const choose = (prefix, remaining) => {
    if (remaining.length === 0) {
      schedules.push(prefix);
      return;
    }
    for (let i = 0; i < remaining.length; i += 1) {
      const event = remaining[i];
      if (
        event[0] === 'finish' &&
        !prefix.some((entry) => entry[0] === 'begin' && entry[1] === event[1])
      ) {
        continue;
      }
      choose(
        [...prefix, event],
        remaining.filter((_, j) => j !== i)
      );
    }
  };
  choose([], actions);
  const scenarios = [];
  for (const schedule of schedules) {
    let wallet = { ...walletSnapshot };
    let budget = { ...budgetSnapshot };
    const operationStates = operations.map((op) => ({ ...op }));
    const proposals = [null, null];
    const outboxes = [null, null];
    const traces = [];
    for (const [event, index] of schedule) {
      const operation = operationStates[index];
      if (event === 'begin') {
        proposals[index] = quoteScoutPointOperation({
          action: 'reserve',
          walletSnapshot: wallet,
          budgetSnapshot: budget,
          operationSnapshot: operation,
          evidence: proof
        });
        traces.push(
          frozen({
            event,
            index,
            status: proposals[index].status
          })
        );
        continue;
      }
      const proposal = proposals[index];
      if (!proposal || proposal.status !== 'proposal_only') {
        traces.push(frozen({ event, index, status: 'not_quoted_noop' }));
        continue;
      }
      const recheck = recheckScoutPointOperation({
        proposal,
        currentWalletSnapshot: wallet,
        currentBudgetSnapshot: budget,
        currentOperationSnapshot: operation,
        duplicateOperationClaimVerified: true,
        duplicateOperationClaimExists: false
      });
      const design = quoteScoutPointAtomicConnection({
        proposal,
        recheck,
        safeguards: guards
      });
      if (
        recheck.status !== 'preconditions_match_only' ||
        design.status !== 'connection_design_only'
      ) {
        traces.push(
          frozen({
            event,
            index,
            status:
              recheck.status === 'stale_snapshot'
                ? 'stale_snapshot_rejected'
                : 'design_rejected'
          })
        );
        continue;
      }
      const enqueue = quoteScoutProviderOutboxEnqueue({
        reservedOperation: proposal.nextOperation,
        reservationDesign: design,
        payload: payloads[index],
        evidence: enqueueEvidence
      });
      if (enqueue.status !== 'outbox_enqueue_quote_only') {
        traces.push(frozen({ event, index, status: 'outbox_design_rejected' }));
        continue;
      }
      // Apply ONLY to a throwaway in-memory model, never to a real wallet.
      wallet = { ...proposal.nextWallet };
      budget = { ...proposal.nextBudget };
      operationStates[index] = { ...proposal.nextOperation };
      outboxes[index] = enqueue.nextOutbox;
      traces.push(
        frozen({
          event,
          index,
          status: 'virtual_reservation_only',
          operationKey: proposal.operationKey,
          idempotencyKey: enqueue.idempotencyKey
        })
      );
    }
    const reservedSum = operationStates.reduce(
      (sum, op) => sum + (op.phase === 'reserved' ? op.amountPoints : 0),
      0
    );
    const invariant = frozen({
      nonnegativeWallet:
        wallet.availablePoints >= 0 && wallet.reservedPoints >= 0,
      walletConserved:
        wallet.availablePoints + wallet.reservedPoints ===
        walletSnapshot.availablePoints,
      walletReservationMatchesOperations: wallet.reservedPoints === reservedSum,
      budgetWithinLimit:
        budget.committedPoints + budget.reservedPoints <= budget.limitPoints,
      budgetReservationMatchesOperations: budget.reservedPoints === reservedSum,
      outboxMatchesReservations: operationStates.every(
        (op, index) => (op.phase === 'reserved') === (outboxes[index] !== null)
      )
    });
    scenarios.push(
      frozen({
        order: frozen(schedule.map(([event, index]) => event + ':' + index)),
        traces: frozen(traces),
        wallet: frozen(wallet),
        budget: frozen(budget),
        operationStates: frozen(operationStates.map((op) => frozen(op))),
        outboxes: frozen(outboxes),
        invariant
      })
    );
  }
  return frozen({
    status: 'bounded_mock_model_only',
    scheduleCount: scenarios.length,
    scenarios: frozen(scenarios),
    ...disabled
  });
}

/**
 * Enumerate explicit crash windows plus all 2^3 persistence combinations.
 * Gate09 recovery is the sole authority for each *design* classification.
 * This does NOT read the DB and cannot prove actual atomic persistence.
 */
export function exploreScoutCrashCutpoints({ operation, outbox }) {
  if (!object(operation) || !object(outbox)) {
    throw new TypeError('Operation and hypothetical outbox required');
  }
  const phases = ['new', 'reserved', 'committed', 'released', 'refunded'];
  const outboxStatuses = [
    'queued',
    'leased',
    'uncertain',
    'delivered',
    'cancelled'
  ];
  const cases = [];
  for (const phase of phases) {
    for (const status of outboxStatuses) {
      for (let mask = 0; mask < 8; mask += 1) {
        const reserved = (mask & 1) !== 0;
        const ledger = (mask & 2) !== 0;
        const outboxDurable = (mask & 4) !== 0;
        const quote = quoteScoutOutboxCrashRecovery({
          operation: { ...operation, phase },
          outbox: { ...outbox, status },
          proof: {
            authoritativeSnapshotVerified: true,
            completeLedgerAndOutboxHistoryVerified: true,
            providerIdentityAndIdempotencyVerified: true,
            reservationDurable: reserved,
            ledgerReservationDurable: ledger,
            outboxDurable
          }
        });
        cases.push(
          frozen({
            phase,
            outboxStatus: status,
            durabilityMask: mask,
            status: quote.status,
            noProviderReplay: quote.mayInvokeProvider === false,
            noDbWrite: quote.mayConnectDb === false,
            noPointMovement: quote.mayMovePointsOrMoney === false
          })
        );
      }
    }
  }
  return frozen({
    status: 'bounded_mock_model_only',
    caseCount: cases.length,
    cases: frozen(cases),
    ...disabled
  });
}

function permutations(list) {
  if (list.length === 0) return [[]];
  const result = [];
  for (let i = 0; i < list.length; i += 1) {
    for (const suffix of permutations(list.filter((_, j) => j !== i))) {
      result.push([list[i], ...suffix]);
    }
  }
  return result;
}

/**
 * Enumerate callback reorderings (up to 4!), including conflicting receipts.
 * Reuses Gate09's dedupe quote, adding a model-level contradiction detector:
 * two fulfilled provider transactions or success + definitive failure for
 * the SAME logical operation must be escalated for manual reconciliation.
 */
export function exploreScoutWebhookPermutations({ operation, outbox, events }) {
  if (
    !object(operation) ||
    !object(outbox) ||
    !Array.isArray(events) ||
    events.length < 1 ||
    events.length > 4 ||
    events.some((event) => !object(event))
  ) {
    throw new TypeError('1-4 hypothetical callback events required');
  }
  const cases = [];
  for (const order of permutations(events)) {
    const history = [];
    const steps = [];
    const uniqueTransactions = new Set();
    const success = [];
    const failure = [];
    let manualHold = false;
    for (const event of order) {
      const quote = quoteScoutProviderNotification({
        operation,
        outbox,
        receipt: event,
        existingReceipts: history,
        evidence: callbackEvidence
      });
      let classification = quote.status;
      if (
        event.outcome === 'succeeded' &&
        typeof event.transactionId === 'string'
      ) {
        uniqueTransactions.add(event.transactionId);
        success.push(event);
      }
      if (event.outcome === 'failed') failure.push(event);
      if (uniqueTransactions.size > 1) {
        classification = 'distinct_provider_transactions_manual_hold';
        manualHold = true;
      } else if (success.length > 0 && failure.length > 0) {
        classification = 'contradictory_terminal_receipts_manual_hold';
        manualHold = true;
      }
      if (
        classification === 'distinct_provider_transactions_manual_hold' ||
        classification === 'contradictory_terminal_receipts_manual_hold' ||
        classification === 'event_id_collision_hold' ||
        classification === 'history_binding_mismatch' ||
        classification === 'notification_binding_mismatch'
      ) {
        manualHold = true;
      }
      steps.push(
        frozen({
          eventId: event.eventId,
          status: classification,
          suggestedLedgerKey: quote.ledgerEventKey ?? null
        })
      );
      // Ephemeral notified-id journal; not actual durable receipt storage.
      if (
        quote.status !== 'duplicate_notification_noop' &&
        quote.status !== 'event_id_collision_hold' &&
        quote.status !== 'notification_binding_mismatch'
      ) {
        history.push(event);
      }
    }
    cases.push(
      frozen({
        order: frozen(order.map((event) => event.eventId)),
        steps: frozen(steps),
        manualHold,
        ...disabled
      })
    );
  }
  return frozen({
    status: 'bounded_mock_model_only',
    caseCount: cases.length,
    cases: frozen(cases),
    ...disabled
  });
}
