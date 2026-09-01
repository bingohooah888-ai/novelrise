export const MASTER_READ_COMPLETE = 'MASTER_READ_COMPLETE';

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return parsed;
}

export function validateMasterReadProof(proof = {}, authoritative = {}) {
  const complete = proof.complete === true;
  const unresolvedTruncation = proof.unresolvedTruncation === true;
  const mainSha = String(proof.mainSha || '').trim();
  const contentSha256 = String(proof.contentSha256 || '').trim();
  const expectedMainSha = String(authoritative.mainSha || '').trim();
  const expectedDigest = String(authoritative.sha256 || '').trim();

  if (!complete) {
    throw new Error('MASTER_READ_COMPLETE proof is required.');
  }
  if (unresolvedTruncation) {
    throw new Error(
      'MASTER_READ_COMPLETE cannot pass while a MASTER range is visibly truncated or unresolved.'
    );
  }
  if (!/^[0-9a-f]{40}$/u.test(mainSha)) {
    throw new Error('MASTER read proof requires an exact latest-main SHA.');
  }
  if (!/^[0-9a-f]{64}$/u.test(contentSha256)) {
    throw new Error('MASTER read proof requires an exact SHA-256 digest.');
  }
  if (mainSha !== expectedMainSha) {
    throw new Error(
      'MASTER read proof is stale or bound to a different main SHA.'
    );
  }
  if (contentSha256 !== expectedDigest) {
    throw new Error(
      'MASTER read proof digest does not match the authoritative latest-main MASTER.'
    );
  }

  const coveredFrom = positiveInteger(proof.coveredFrom, 'MASTER covered-from');
  const coveredThrough = positiveInteger(
    proof.coveredThrough,
    'MASTER covered-through'
  );
  const eofLine = positiveInteger(proof.eofLine, 'MASTER EOF line');
  const expectedLines = positiveInteger(
    authoritative.lines,
    'Authoritative MASTER line count'
  );

  if (coveredFrom !== 1) {
    throw new Error('MASTER read coverage must start at line 1.');
  }
  if (coveredThrough !== eofLine) {
    throw new Error(
      'MASTER read coverage must be contiguous through the confirmed EOF line.'
    );
  }
  if (eofLine !== expectedLines) {
    throw new Error(
      'MASTER EOF proof does not match the authoritative latest-main MASTER.'
    );
  }

  return {
    status: MASTER_READ_COMPLETE,
    complete,
    unresolvedTruncation,
    mainSha,
    contentSha256,
    coveredFrom,
    coveredThrough,
    eofLine
  };
}

export function classifyBootstrapRecovery({
  cardVisible = false,
  readOnlyProjectReadBeforeMasterComplete = false,
  toolBeforeCard = false,
  unauthorizedImageTool = false,
  externalMutationStarted = false,
  secretOperationStarted = false,
  productionOperationStarted = false,
  destructiveOperationStarted = false,
  billingOperationStarted = false,
  oneTimeClaimOrConsumeStarted = false
} = {}) {
  const hardFail =
    toolBeforeCard ||
    unauthorizedImageTool ||
    externalMutationStarted ||
    secretOperationStarted ||
    productionOperationStarted ||
    destructiveOperationStarted ||
    billingOperationStarted ||
    oneTimeClaimOrConsumeStarted;

  if (hardFail) return 'hard-fail';
  if (!readOnlyProjectReadBeforeMasterComplete) return 'none';
  return cardVisible ? 'recoverable-reset-retry' : 'hard-fail';
}
