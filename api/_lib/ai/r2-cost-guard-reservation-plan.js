// OFFLINE ONLY: an R2 reservation proposal, never a cloud admission decision.
// A future Worker/D1 implementation must re-evaluate limits and commit the
// reservation atomically BEFORE R2 operations. Nothing here writes to R2.
import {
  evaluateR2CostGuard,
  R2_FREE_ALLOWANCE,
  R2_COST_GUARD_THRESHOLDS
} from './r2-cost-guard.js';

const GB = 1_000_000_000;
const ACTION_CLASS = Object.freeze({
  PutObject: 'A',
  ListObjects: 'A',
  GetObject: 'B',
  HeadObject: 'B'
});

const integer = (value) => Number.isSafeInteger(value) && value >= 0;

function denied(reason) {
  return Object.freeze({
    state: 'denied',
    reason,
    mayExecute: false,
    requiresAtomicReservation: true,
    reservation: null
  });
}

export function planR2ReservationOffline({
  snapshot,
  intent,
  pendingReservations,
  now = Date.now()
} = {}) {
  // A status read, or this optimistic plan, must never grant R2 access.
  const decision = evaluateR2CostGuard(snapshot, { now });
  if (
    decision.state === 'unverified' ||
    decision.stopRequired ||
    decision.stopConfirmed
  ) {
    return denied('R2_GUARD_DENIED_OR_UNVERIFIED');
  }

  const kind = ACTION_CLASS[intent?.action];
  if (!Object.hasOwn(ACTION_CLASS, intent?.action ?? '')) {
    return denied('R2_OPERATION_NOT_ALLOWLISTED');
  }
  if (
    !integer(intent?.operationCount) ||
    intent.operationCount < 1 ||
    intent.operationCount > 1024 ||
    !integer(intent?.newStoredBytes) ||
    (intent.action === 'PutObject' && intent.newStoredBytes < 1) ||
    (intent.action !== 'PutObject' && intent.newStoredBytes !== 0)
  ) {
    return denied('R2_OPERATION_COST_NOT_BOUNDED');
  }

  // These inputs must eventually come from one durable, account-wide
  // reservation ledger, not a browser or a casual dashboard counter.
  const accounting = snapshot.storageAccounting;
  if (
    accounting?.mode !== 'accrued-standard-gb-month' ||
    accounting?.measuredAt !== snapshot.observedAt ||
    accounting?.allAccountBucketsCovered !== true ||
    !integer(accounting?.currentStandardStoredBytes)
  ) {
    return denied('R2_STORAGE_ACCOUNTING_UNVERIFIED');
  }
  if (
    !pendingReservations ||
    !integer(pendingReservations.classAOperations) ||
    !integer(pendingReservations.classBOperations) ||
    !integer(pendingReservations.newStoredBytes)
  ) {
    return denied('R2_RESERVATION_LEDGER_UNVERIFIED');
  }

  const start = Date.parse(snapshot.billingPeriodStart);
  const end = Date.parse(snapshot.billingPeriodEnd);
  const fractionRemaining = (end - now) / (end - start);
  if (
    !Number.isFinite(fractionRemaining) ||
    fractionRemaining <= 0 ||
    fractionRemaining > 1
  ) {
    return denied('R2_BILLING_PERIOD_UNVERIFIED');
  }

  // Pessimistically assume all currently stored objects and proposed new
  // objects remain until the billing period ends. This is a planning
  // estimate; Cloudflare's actual daily-peak accounting still governs.
  const forecastStorageGbMonth =
    snapshot.usage.storageGbMonth +
    ((accounting.currentStandardStoredBytes +
      pendingReservations.newStoredBytes +
      intent.newStoredBytes) /
      GB) *
      fractionRemaining;

  const projectedA =
    snapshot.usage.classAOperations +
    pendingReservations.classAOperations +
    (kind === 'A' ? intent.operationCount : 0);
  const projectedB =
    snapshot.usage.classBOperations +
    pendingReservations.classBOperations +
    (kind === 'B' ? intent.operationCount : 0);

  if (
    !Number.isFinite(forecastStorageGbMonth) ||
    forecastStorageGbMonth >=
      R2_FREE_ALLOWANCE.storageGbMonth * R2_COST_GUARD_THRESHOLDS.stop ||
    projectedA >=
      R2_FREE_ALLOWANCE.classAOperations * R2_COST_GUARD_THRESHOLDS.stop ||
    projectedB >=
      R2_FREE_ALLOWANCE.classBOperations * R2_COST_GUARD_THRESHOLDS.stop
  ) {
    return denied('R2_FORECAST_OR_RESERVATION_CAP_REACHED');
  }

  return Object.freeze({
    state: 'eligible-for-atomic-reservation',
    reason: null,
    mayExecute: false,
    requiresAtomicReservation: true,
    reservation: Object.freeze({
      action: intent.action,
      classAOperations: kind === 'A' ? intent.operationCount : 0,
      classBOperations: kind === 'B' ? intent.operationCount : 0,
      newStoredBytes: intent.newStoredBytes,
      projected: {
        storageGbMonth: Math.round(forecastStorageGbMonth * 1e6) / 1e6,
        classAOperations: projectedA,
        classBOperations: projectedB
      }
    })
  });
}
