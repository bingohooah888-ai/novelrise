// NOVELIGHT βScout Point10倍: independent, intentionally NON-LIVE trust contracts.
// Not a workflow, executable authorization, database adapter, deployment hook,
// network client, or storage driver. No I/O on import or invocation.
import {
  createHash,
  createPublicKey,
  verify as verifySignature
} from 'node:crypto';

export const CONFIG = Object.freeze({
  repo: 'bingohooah888-ai/novelrise',
  ownerId: 317436651,
  ownerLogin: 'bingohooah888-ai',
  issue: 294,
  scope:
    'reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly',
  operation: 'read-catalog-11-same-snapshot',
  stagingRef: 'wmlzjgvxgoyrovdhbqbg',
  productionRef: 'fiepaguycecrredwrcwx',
  proposedReaderRole: 'novelight_point10x_catalog_reader',
  workflowRef:
    'bingohooah888-ai/novelrise/.github/workflows/scout-point10x-readonly.yml@refs/heads/main',
  sourceSqlDigests: Object.freeze([
    '740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11',
    '6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1'
  ]),
  controlMutationDomain: 'issue294-point10x-all-staging-writers'
});

export const SECTION_IDS = Object.freeze([
  ...Array.from(
    { length: 8 },
    (_, i) => 'NL-CATALOG-' + String(i + 1).padStart(2, '0')
  ),
  ...Array.from(
    { length: 3 },
    (_, i) => 'NL-GAP-' + String(i + 1).padStart(2, '0')
  )
]);
const isRecord = (x) =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x, required) =>
  isRecord(x) &&
  Object.keys(x).sort().join('|') === [...required].sort().join('|');
const hex = (v, n) =>
  typeof v === 'string' && new RegExp('^[0-9a-f]{' + n + '}$', 'u').test(v);
const hold = (reason) => {
  throw new Error('POINT10X_OFFLINE_HOLD:' + reason);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canon = (x) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(x)
        .sort()
        .map((k) => [k, x[k]])
    )
  );
const frozenNoGo = (kind, details = {}) =>
  Object.freeze({ status: 'NO_GO_' + kind, ...details, liveAuthorized: false });

const EVENT_KEYS = Object.freeze([
  'action',
  'actorId',
  'actorLogin',
  'commentCreatedAt',
  'commentId',
  'commentUpdatedAt',
  'deliveryId',
  'eventName',
  'issueNumber',
  'mainSha',
  'ownerScopeMarker',
  'repository',
  'repositoryOwnerId',
  'runAttempt',
  'runner',
  'workflowRef',
  'workflowSha'
]);

// Contract input must be captured inside a future GitHub-hosted trusted-main
// workflow; local/object values are NOT proof of GitHub origin or OWNER approval.
export function inspectTrustedMainEventShape(event, expectedMainSha) {
  if (
    !keys(event, EVENT_KEYS) ||
    !hex(expectedMainSha, 40) ||
    event.repository !== CONFIG.repo ||
    event.repositoryOwnerId !== CONFIG.ownerId ||
    event.actorId !== CONFIG.ownerId ||
    event.actorLogin !== CONFIG.ownerLogin ||
    event.issueNumber !== CONFIG.issue ||
    event.eventName !== 'issue_comment' ||
    event.action !== 'created' ||
    event.runner !== 'github-actions' ||
    event.runAttempt !== 1 ||
    event.workflowRef !== CONFIG.workflowRef ||
    event.mainSha !== expectedMainSha ||
    event.workflowSha !== expectedMainSha ||
    event.ownerScopeMarker !== 'NOVELIGHT_POINT10X_READONLY_OWNER_V2' ||
    !Number.isSafeInteger(event.commentId) ||
    event.commentId <= 0 ||
    !/^[0-9a-f-]{36}$/u.test(event.deliveryId) ||
    event.commentCreatedAt !== event.commentUpdatedAt ||
    !Number.isFinite(Date.parse(event.commentCreatedAt))
  )
    hold('TRUSTED_MAIN_EVENT_SHAPE');
  return frozenNoGo('EVENT_SHAPE_ONLY', {
    eventDigest: hash(Buffer.from(canon(event))),
    mainSha: expectedMainSha,
    ownerAuthenticated: false,
    githubEventAuthenticated: false,
    oneUseApprovalConsumed: false
  });
}

const CONTROL_KEYS = Object.freeze([
  'approvalDigest',
  'commentId',
  'expectedEpoch',
  'mainSha',
  'manifestDigest',
  'mutationDomain',
  'operation',
  'pr2766Head',
  'pr2767Head',
  'repo',
  'runCount',
  'scope',
  'stagingRef'
]);

// Prepare a canonical *proposal* only. There is no PostgreSQL import, secret,
// query, mutation, or external adapter; a proposal is not a CAS grant.
export function planIndependentControlCas(tuple) {
  if (
    !keys(tuple, CONTROL_KEYS) ||
    tuple.repo !== CONFIG.repo ||
    tuple.scope !== CONFIG.scope ||
    tuple.operation !== CONFIG.operation ||
    tuple.stagingRef !== CONFIG.stagingRef ||
    tuple.mutationDomain !== CONFIG.controlMutationDomain ||
    tuple.runCount !== 1 ||
    !Number.isSafeInteger(tuple.commentId) ||
    tuple.commentId <= 0 ||
    !Number.isSafeInteger(tuple.expectedEpoch) ||
    tuple.expectedEpoch < 0 ||
    ![tuple.mainSha, tuple.pr2766Head, tuple.pr2767Head].every((x) =>
      hex(x, 40)
    ) ||
    ![tuple.manifestDigest, tuple.approvalDigest].every((x) => hex(x, 64))
  )
    hold('CONTROL_CAS_PROPOSAL_INVALID');
  const digest = hash(Buffer.from(canon(tuple)));
  return frozenNoGo('CONTROL_CAS_PLAN_ONLY', {
    proposalDigest: digest,
    mutationDomain: CONFIG.controlMutationDomain,
    expectedEpoch: tuple.expectedEpoch,
    commentId: tuple.commentId,
    realControlConnected: false,
    realSpentCommitted: false,
    commitAckVerified: false,
    automaticRetryAllowed: false
  });
}

const ROLE_KEYS = Object.freeze([
  'canConnect',
  'canCreateSchema',
  'canCreateTemp',
  'canDml',
  'canExecuteUnapproved',
  'canReadCatalog',
  'canSetRole',
  'connectionRef',
  'dbOwner',
  'effectiveRole',
  'grantMembers',
  'isStaging',
  'rolBypassRls',
  'rolCreateDb',
  'rolCreateRole',
  'rolInherit',
  'rolReplication',
  'rolSuper',
  'serverFingerprint',
  'sessionUser',
  'stagingRef'
]);

export function inspectStagingReaderProbe(probe) {
  if (
    !keys(probe, ROLE_KEYS) ||
    probe.stagingRef !== CONFIG.stagingRef ||
    probe.connectionRef !== CONFIG.stagingRef ||
    probe.isStaging !== true ||
    probe.stagingRef === CONFIG.productionRef ||
    probe.sessionUser !== CONFIG.proposedReaderRole ||
    probe.effectiveRole !== CONFIG.proposedReaderRole ||
    !hex(probe.serverFingerprint, 64) ||
    probe.canConnect !== true ||
    probe.canReadCatalog !== true ||
    !Array.isArray(probe.grantMembers) ||
    probe.grantMembers.length !== 0 ||
    [
      'canCreateSchema',
      'canCreateTemp',
      'canDml',
      'canExecuteUnapproved',
      'canSetRole',
      'dbOwner',
      'rolBypassRls',
      'rolCreateDb',
      'rolCreateRole',
      'rolInherit',
      'rolReplication',
      'rolSuper'
    ].some((key) => probe[key] !== false)
  )
    hold('STAGING_ROLE_PROBE_REJECTED');
  return frozenNoGo('STAGING_ROLE_SHAPE_ONLY', {
    role: probe.effectiveRole,
    stagingRef: CONFIG.stagingRef,
    serverFingerprint: probe.serverFingerprint,
    actualPgAclAuthenticated: false,
    actualDbConnected: false
  });
}

const AUDIT_KEYS = Object.freeze([
  'approvalDigest',
  'closeAck',
  'controlSpentDigest',
  'evidencePolicyDigest',
  'mainSha',
  'manifestDigest',
  'ownerProofDigest',
  'prHeadSha',
  'readRoleDigest',
  'rollbackAck',
  'runId',
  'sections',
  'snapshotDigest',
  'sourceSqlDigests',
  'stagingRef',
  'transactionMode'
]);
export function assembleRedactedAuditEvidence(value) {
  if (
    !keys(value, AUDIT_KEYS) ||
    value.stagingRef !== CONFIG.stagingRef ||
    value.transactionMode !==
      'ONE_CONNECTION_REPEATABLE_READ_READ_ONLY_ROLLBACK' ||
    value.closeAck !== true ||
    value.rollbackAck !== true ||
    !/^[a-zA-Z0-9_-]{12,80}$/u.test(value.runId ?? '') ||
    !hex(value.mainSha, 40) ||
    !hex(value.prHeadSha, 40) ||
    ![
      value.approvalDigest,
      value.controlSpentDigest,
      value.evidencePolicyDigest,
      value.manifestDigest,
      value.ownerProofDigest,
      value.readRoleDigest,
      value.snapshotDigest
    ].every((x) => hex(x, 64)) ||
    !Array.isArray(value.sourceSqlDigests) ||
    JSON.stringify(value.sourceSqlDigests) !==
      JSON.stringify(CONFIG.sourceSqlDigests) ||
    !Array.isArray(value.sections) ||
    value.sections.length !== 11
  )
    hold('AUDIT_ENVELOPE_INVALID');
  const sections = value.sections.map((x, i) => {
    if (
      !keys(x, ['id', 'rowCount', 'resultDigest']) ||
      x.id !== SECTION_IDS[i] ||
      !hex(x.resultDigest, 64) ||
      !Number.isSafeInteger(x.rowCount) ||
      x.rowCount < 0 ||
      x.rowCount > 100000
    )
      hold('AUDIT_SECTION_REJECTED');
    return Object.freeze({
      id: x.id,
      rowCount: x.rowCount,
      resultDigest: x.resultDigest
    });
  });
  const payload = Object.freeze({
    ...value,
    sourceSqlDigests: Object.freeze([...value.sourceSqlDigests]),
    sections: Object.freeze(sections)
  });
  const canonicalBody = canon(payload);
  return frozenNoGo('AUDIT_REDACTED_SHAPE_ONLY', {
    digest: hash(Buffer.from(canonicalBody)),
    canonicalBody,
    payload,
    actualResultsVerified: false,
    independentStorageVerified: false
  });
}

// Ed25519 authenticity check with separately pinned public key. Mathematical
// verification is NOT proof of independent signer, storage or retention.
export function verifyOfflineAuditSignature({
  canonicalBody,
  digest,
  signatureBase64,
  pinnedSpkiSha256,
  publicKeyPem
} = {}) {
  if (
    typeof canonicalBody !== 'string' ||
    canonicalBody.length > 30000 ||
    !hex(digest, 64) ||
    hash(Buffer.from(canonicalBody)) !== digest ||
    typeof signatureBase64 !== 'string' ||
    !/^[A-Za-z0-9+/]{86}==$/u.test(signatureBase64) ||
    typeof publicKeyPem !== 'string' ||
    !hex(pinnedSpkiSha256, 64)
  )
    hold('AUDIT_RECEIPT_SHAPE');
  let key;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    hold('AUDITOR_PUBKEY_INVALID');
  }
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    hash(key.export({ type: 'spki', format: 'der' })) !== pinnedSpkiSha256
  )
    hold('AUDITOR_KEY_NOT_PINNED');
  const signature = Buffer.from(signatureBase64, 'base64');
  if (
    signature.length !== 64 ||
    signature.toString('base64') !== signatureBase64 ||
    !verifySignature(null, Buffer.from(canonicalBody), key, signature)
  )
    hold('AUDIT_SIGNATURE_INVALID');
  return frozenNoGo('AUDIT_SIGNATURE_MATH_ONLY', {
    digest,
    retentionVerified: false,
    independentSignerVerified: false,
    immutableStorageVerified: false
  });
}

// LIVE enablement is deliberately absent even after all offline checks.
export async function executeTrustedReadOnly() {
  hold('NO_TRUSTED_MAIN_OWNER_CAS_ROLE_OR_INDEPENDENT_AUDIT');
}
