// Deterministic IN-MEMORY failure simulator for CONTROL/AUDIT boundaries.
// Not a persistent ledger, database, WORM, trusted signer, or runtime adapter.
// Never pass actual credentials, real OWNER grants or private user data.
import { createHash } from 'node:crypto';

const isHash = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/u.test(x);
const fail = (why) => {
  throw new Error('POINT10X_SIM_HOLD:' + why);
};
const digest = (x) => createHash('sha256').update(x).digest('hex');
const result = (status, extras = {}) =>
  Object.freeze({
    status,
    ...extras,
    liveAuthorized: false,
    realControlConnected: false
  });

export function createEphemeralControlSimulator({ initialEpoch = 0 } = {}) {
  if (!Number.isSafeInteger(initialEpoch) || initialEpoch < 0)
    fail('INVALID_INITIAL_EPOCH');
  let epoch = initialEpoch;
  const spent = new Map();
  // Each synchronous operation linearizes without an await. This is NOT
  // proof of actual PostgreSQL serializability, crash recovery or durability.
  function claim({ plan, ack = 'confirmed' } = {}) {
    if (
      !plan ||
      plan.status !== 'NO_GO_CONTROL_CAS_PLAN_ONLY' ||
      !isHash(plan.proposalDigest) ||
      !Number.isSafeInteger(plan.commentId) ||
      plan.commentId <= 0 ||
      !Number.isSafeInteger(plan.expectedEpoch) ||
      plan.expectedEpoch < 0 ||
      !['confirmed', 'unknown', 'fail-before-commit'].includes(ack)
    )
      fail('CAS_SIM_INPUT');
    if (spent.has(plan.commentId))
      return result('NO_GO_SIM_REPLAY_SPENT', {
        simulatedEpoch: epoch,
        simulatedSpent: true,
        realSpent: false
      });
    if (plan.expectedEpoch !== epoch)
      return result('NO_GO_SIM_EPOCH_STALE', {
        simulatedEpoch: epoch,
        simulatedSpent: false,
        realSpent: false
      });
    if (ack === 'fail-before-commit')
      return result('NO_GO_SIM_COMMIT_ABORTED', {
        simulatedEpoch: epoch,
        simulatedSpent: false,
        realSpent: false
      });
    spent.set(plan.commentId, plan.proposalDigest);
    epoch += 1;
    // Lost ACK is TERMINAL HOLD. An automatic retry would be unsafe.
    return result(
      ack === 'unknown'
        ? 'NO_GO_SIM_COMMIT_ACK_UNKNOWN_HOLD'
        : 'NO_GO_SIM_CLAIM_CONFIRMED_ONLY',
      {
        simulatedEpoch: epoch,
        simulatedSpent: true,
        realSpent: false,
        noAutomaticRetry: true
      }
    );
  }
  function readback(commentId) {
    if (!Number.isSafeInteger(commentId) || commentId <= 0)
      fail('READBACK_ID_INVALID');
    return result('NO_GO_SIM_READBACK_NOT_AUTHORITATIVE', {
      simulatedSpent: spent.has(commentId),
      simulatedEpoch: epoch,
      realSpent: false,
      requiresIndependentControlPrimary: true
    });
  }
  return Object.freeze({ claim, readback });
}

export function createEphemeralAuditSimulator() {
  const receipts = new Map();
  const append = ({
    runId,
    digestSha256,
    canonicalBody,
    expiresAt,
    now
  } = {}) => {
    if (
      typeof runId !== 'string' ||
      !/^[a-zA-Z0-9_-]{12,80}$/u.test(runId) ||
      !isHash(digestSha256) ||
      typeof canonicalBody !== 'string' ||
      canonicalBody.length > 30000 ||
      digest(canonicalBody) !== digestSha256 ||
      !Number.isFinite(Date.parse(expiresAt)) ||
      !Number.isFinite(Date.parse(now)) ||
      Date.parse(expiresAt) <= Date.parse(now)
    )
      fail('AUDIT_APPEND_INVALID');
    if (receipts.has(runId)) fail('AUDIT_APPEND_DUPLICATE');
    receipts.set(
      runId,
      Object.freeze({ digestSha256, canonicalBody, expiresAt })
    );
    return result('NO_GO_SIM_AUDIT_APPENDED_IN_MEMORY', {
      digestSha256,
      immutableExternalStorage: false,
      retentionVerified: false
    });
  };
  const readback = ({ runId, now } = {}) => {
    if (typeof runId !== 'string' || !Number.isFinite(Date.parse(now)))
      fail('AUDIT_READBACK_INVALID');
    const item = receipts.get(runId);
    if (!item) fail('AUDIT_MISSING');
    if (Date.parse(now) >= Date.parse(item.expiresAt))
      fail('AUDIT_RETENTION_EXPIRED');
    if (digest(item.canonicalBody) !== item.digestSha256)
      fail('AUDIT_TAMPERED');
    return result('NO_GO_SIM_AUDIT_READBACK_IN_MEMORY', {
      digestSha256: item.digestSha256,
      immutableExternalStorage: false,
      retentionVerified: false,
      payloadReleased: false
    });
  };
  return Object.freeze({ append, readback });
}
