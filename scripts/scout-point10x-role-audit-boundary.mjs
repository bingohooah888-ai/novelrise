// Proposed least-privilege and independent-audit admission primitives.
// These are offline guards and signature checks, not PostgreSQL/CONTROL adapters.
// No dynamic SQL, secrets, DB connections, or approval consumption exists here.
import {
  createHash,
  createPublicKey,
  verify as cryptoVerify
} from 'node:crypto';
import {
  SCOPE as READONLY_SCOPE,
  STAGING_REF,
  PRODUCTION_REF
} from './scout-point10x-owner-readonly-evidence.mjs';

const hash = (x) => createHash('sha256').update(x).digest('hex');
const rec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const hex = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/u.test(x);
const reject = (reason) => {
  throw new Error('POINT10X_AUDIT_HOLD:' + reason);
};
const sortedCanonical = (x) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(x)
        .sort()
        .map((k) => [k, x[k]])
    )
  );
const exact = (x, keys) =>
  rec(x) && Object.keys(x).sort().join('|') === [...keys].sort().join('|');
const ID_LIST = Object.freeze([
  ...Array.from(
    { length: 8 },
    (_, i) => 'NL-CATALOG-' + String(i + 1).padStart(2, '0')
  ),
  ...Array.from(
    { length: 3 },
    (_, i) => 'NL-GAP-' + String(i + 1).padStart(2, '0')
  )
]);
export const AUDIT_SECTION_IDS = ID_LIST;
export const EXPECTED_READER_ROLE = 'novelight_point10x_catalog_reader';
export const AUDIT_FIELDS = Object.freeze([
  'controlSpentProofDigest',
  'evidencePolicyDigest',
  'executorDigest',
  'githubOwnerProofDigest',
  'manifestDigest',
  'mainSha',
  'prHeadSha',
  'readRoleProofDigest',
  'rollbackAck',
  'closeAck',
  'runId',
  'scope',
  'snapshotDigest',
  'sourceSqlDigests',
  'stagingRef',
  'transactionMode',
  'sectionEvidence'
]);

// Role facts must come from a future trusted PostgreSQL role/ACL probe;
// the returned decision deliberately NEVER authorizes a connection.
export function inspectProposedReadOnlyRole(probe) {
  if (
    !exact(probe, [
      'role',
      'stagingRef',
      'connectionRef',
      'isPrimaryStaging',
      'rolsuper',
      'rolbypassrls',
      'rolcreaterole',
      'rolcreatedb',
      'rolreplication',
      'rolinherit',
      'rolcanlogin',
      'isDbOwner',
      'isServiceRole',
      'pgWriteAllData',
      'canSetRole',
      'canCreateSchema',
      'canCreateTemp',
      'canInsert',
      'canUpdate',
      'canDelete',
      'canTruncate',
      'canTrigger',
      'canExecuteUnapprovedFunction',
      'canReadRequiredCatalogs',
      'memberships'
    ])
  )
    reject('ROLE_PROBE_FIELDS');
  if (
    probe.stagingRef !== STAGING_REF ||
    probe.stagingRef === PRODUCTION_REF ||
    probe.connectionRef !== STAGING_REF ||
    probe.isPrimaryStaging !== true ||
    probe.role !== EXPECTED_READER_ROLE ||
    probe.rolcanlogin !== true ||
    probe.canReadRequiredCatalogs !== true ||
    !Array.isArray(probe.memberships) ||
    probe.memberships.length !== 0 ||
    [
      'rolsuper',
      'rolbypassrls',
      'rolcreaterole',
      'rolcreatedb',
      'rolreplication',
      'rolinherit',
      'isDbOwner',
      'isServiceRole',
      'pgWriteAllData',
      'canSetRole',
      'canCreateSchema',
      'canCreateTemp',
      'canInsert',
      'canUpdate',
      'canDelete',
      'canTruncate',
      'canTrigger',
      'canExecuteUnapprovedFunction'
    ].some((key) => probe[key] !== false)
  )
    reject('STAGING_ROLE_NOT_MINIMAL');
  return Object.freeze({
    status: 'NO_GO_ROLE_PROBE_SHAPE_ONLY',
    requireTrustedIndependentAttestation: true,
    mayOpenConnection: false,
    role: EXPECTED_READER_ROLE,
    stagingRef: STAGING_REF
  });
}

export function buildSanitizedAuditEnvelope(value) {
  if (
    !exact(value, AUDIT_FIELDS) ||
    value.scope !== READONLY_SCOPE ||
    value.stagingRef !== STAGING_REF ||
    value.transactionMode !==
      'ONE_CONNECTION_REPEATABLE_READ_READ_ONLY_ROLLBACK' ||
    value.rollbackAck !== true ||
    value.closeAck !== true ||
    typeof value.runId !== 'string' ||
    !/^[a-zA-Z0-9_-]{12,80}$/u.test(value.runId) ||
    !/^[0-9a-f]{40}$/u.test(value.mainSha) ||
    !/^[0-9a-f]{40}$/u.test(value.prHeadSha) ||
    ![
      value.controlSpentProofDigest,
      value.evidencePolicyDigest,
      value.executorDigest,
      value.githubOwnerProofDigest,
      value.manifestDigest,
      value.readRoleProofDigest,
      value.snapshotDigest
    ].every(hex) ||
    !Array.isArray(value.sourceSqlDigests) ||
    value.sourceSqlDigests.length !== 2 ||
    value.sourceSqlDigests[0] !==
      '740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11' ||
    value.sourceSqlDigests[1] !==
      '6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1' ||
    !Array.isArray(value.sectionEvidence) ||
    value.sectionEvidence.length !== 11
  )
    reject('EVIDENCE_ENVELOPE_INVALID');
  const safeSections = value.sectionEvidence.map((s, i) => {
    if (
      !exact(s, ['id', 'rowCount', 'resultDigest']) ||
      s.id !== ID_LIST[i] ||
      !Number.isSafeInteger(s.rowCount) ||
      s.rowCount < 0 ||
      s.rowCount > 100000 ||
      !hex(s.resultDigest)
    )
      reject('SECTION_EVIDENCE_INVALID');
    return Object.freeze({
      id: s.id,
      rowCount: s.rowCount,
      resultDigest: s.resultDigest
    });
  });
  const payload = Object.freeze({
    ...value,
    sourceSqlDigests: Object.freeze([...value.sourceSqlDigests]),
    sectionEvidence: Object.freeze(safeSections)
  });
  const canonicalBody = sortedCanonical(payload);
  return Object.freeze({
    status: 'NO_GO_SANITIZED_UNTRUSTED_ENVELOPE',
    digest: hash(Buffer.from(canonicalBody)),
    canonicalBody,
    payload
  });
}

// Mathematical signature verification only. A pinned independent auditor
// public key must be approved OUTSIDE this PR and served by trusted main.
export function verifyIndependentAuditReceipt({
  envelope,
  signatureBase64,
  publicKeyPem,
  pinnedSpkiSha256
} = {}) {
  if (
    !rec(envelope) ||
    !hex(envelope.digest) ||
    typeof envelope.canonicalBody !== 'string' ||
    envelope.canonicalBody.length > 32000 ||
    hash(Buffer.from(envelope.canonicalBody)) !== envelope.digest ||
    typeof signatureBase64 !== 'string' ||
    !/^[A-Za-z0-9+/]{86}==$/u.test(signatureBase64) ||
    typeof publicKeyPem !== 'string' ||
    !hex(pinnedSpkiSha256)
  )
    reject('AUDIT_SIGNED_INPUT_INVALID');
  let key;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    reject('PUBLIC_KEY_INVALID');
  }
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    hash(key.export({ type: 'spki', format: 'der' })) !== pinnedSpkiSha256
  )
    reject('AUDITOR_KEY_NOT_PINNED');
  const signature = Buffer.from(signatureBase64, 'base64');
  if (
    signature.length !== 64 ||
    signature.toString('base64') !== signatureBase64 ||
    !cryptoVerify(null, Buffer.from(envelope.canonicalBody), key, signature)
  )
    reject('AUDITOR_SIGNATURE_FAILED');
  return Object.freeze({
    status: 'NO_GO_SIGNATURE_VERIFIED_ONLY',
    pinnedSpkiSha256,
    digest: envelope.digest,
    independentStorageVerified: false,
    retentionVerified: false,
    readOnlyStagingApproved: false
  });
}
