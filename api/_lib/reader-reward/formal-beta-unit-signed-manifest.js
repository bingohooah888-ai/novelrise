// Offline-only proof BINDING for beta Point unit claims.
// A valid signature proves integrity against the supplied public key, not
// that the signer was authorized or that the snapshot covers the live DB.
// No DB connection, mutation, secret, provider or public endpoint is created.
import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  SCOUT_MIXED_BETA_POINT_UNITS,
  quoteScoutOfflineBetaHandoff
} from './formal-cutover-offline.js';
import {
  SCOUT_POINT_LEGACY_VERSION,
  SCOUT_POINT_TARGET_VERSION
} from './beta-point-tenfold-plan.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const EVIDENCE_REF = /^[a-z0-9][a-z0-9:_/.-]{7,159}$/;
const MESSAGE_SCOPE = 'NOVELIGHT:SCOUT:BETA-POINT-UNIT-MANIFEST:v1';
const MAX_ROWS = 50000;
const sha256 = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex');
const hold = (status) =>
  Object.freeze({
    status,
    mayMigrateDb: false,
    mayIssuePoints: false,
    mayRedeem: false,
    signedIssuerAuthorized: false,
    independentLiveLedgerCensusVerified: false,
    readyForRealCutover: false
  });

// Only the economic identity needed by the legacy handoff is bound. This
// digest does not claim to authenticate metadata, timestamps or the full
// database row. Those must be audited independently before any real cutover.
function economicRow(row) {
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    !UUID.test(row.id) ||
    !UUID.test(row.user_id) ||
    typeof row.event_key !== 'string' ||
    row.event_key.length < 1 ||
    row.event_key.length > 240 ||
    typeof row.point_kind !== 'string' ||
    row.point_kind.length < 1 ||
    row.point_kind.length > 80 ||
    !Number.isSafeInteger(row.point_value) ||
    Math.abs(row.point_value) > 1000000 ||
    row.status !== 'confirmed' ||
    (row.reversal_of !== null &&
      row.reversal_of !== undefined &&
      !UUID.test(row.reversal_of))
  )
    throw new TypeError('Valid canonical Point economic row required');
  return {
    id: row.id,
    userId: row.user_id,
    eventKey: row.event_key,
    pointKind: row.point_kind,
    value: row.point_value,
    status: row.status,
    reversalOf: row.reversal_of ?? null
  };
}

export function fingerprintScoutBetaPointRow(row) {
  return sha256(
    MESSAGE_SCOPE + ':row\n' + JSON.stringify(economicRow(row))
  );
}

/**
 * Construct deterministic, separate-signable proof bytes from a complete
 * CALLER-SUPPLIED offline snapshot. An assertion is not a verified writer
 * record simply because it includes an evidenceRef and a row hash.
 *
 * No timestamp, amount, point kind or rule_version infers a Point unit.
 */
export function buildScoutBetaUnitManifestMessage({
  canonicalLedgerRows,
  unitAssertions
} = {}) {
  if (
    !Array.isArray(canonicalLedgerRows) ||
    !Array.isArray(unitAssertions) ||
    canonicalLedgerRows.length > MAX_ROWS ||
    canonicalLedgerRows.length !== unitAssertions.length
  )
    throw new TypeError('Complete bounded ledger and unit assertions required');
  const rows = new Map();
  const keys = new Set();
  for (const row of canonicalLedgerRows) {
    const normalized = economicRow(row);
    if (rows.has(normalized.id) || keys.has(normalized.eventKey))
      throw new Error('Duplicate canonical Point row or event key');
    rows.set(normalized.id, {
      fingerprint: fingerprintScoutBetaPointRow(row),
      assertedUnit: row.sourceUnitVersion
    });
    keys.add(normalized.eventKey);
  }
  const assertions = new Map();
  for (const assertion of unitAssertions) {
    if (
      !assertion ||
      typeof assertion !== 'object' ||
      Array.isArray(assertion) ||
      !UUID.test(assertion.ledgerId) ||
      !DIGEST.test(assertion.canonicalRowSha256) ||
      ![
        SCOUT_POINT_LEGACY_VERSION,
        SCOUT_POINT_TARGET_VERSION
      ].includes(assertion.sourceUnitVersion) ||
      typeof assertion.evidenceRef !== 'string' ||
      !EVIDENCE_REF.test(assertion.evidenceRef) ||
      assertions.has(assertion.ledgerId)
    )
      throw new Error('Invalid or repeated Point unit evidence assertion');
    const row = rows.get(assertion.ledgerId);
    if (
      !row ||
      row.fingerprint !== assertion.canonicalRowSha256 ||
      (row.assertedUnit !== undefined &&
        row.assertedUnit !== assertion.sourceUnitVersion)
    )
      throw new Error('Point evidence does not match canonical row');
    assertions.set(assertion.ledgerId, assertion);
  }
  if (assertions.size !== rows.size)
    throw new Error('Unit assertions do not cover every canonical row');
  const claims = [...assertions.values()]
    .sort((a, b) => a.ledgerId.localeCompare(b.ledgerId, 'en'))
    .map((a) => ({
      ledgerId: a.ledgerId,
      canonicalRowSha256: a.canonicalRowSha256,
      sourceUnitVersion: a.sourceUnitVersion,
      evidenceRef: a.evidenceRef
    }));
  const message =
    MESSAGE_SCOPE +
    '\n' +
    JSON.stringify({ rowCount: rows.size, claims });
  return Object.freeze({
    status: 'offline_unit_manifest_message_only',
    message,
    messageSha256: sha256(message),
    rowCount: rows.size,
    mayMigrateDb: false,
    signedIssuerAuthorized: false,
    independentLiveLedgerCensusVerified: false
  });
}

/**
 * Verify a detached Ed25519 signature, then reuse the EXISTING beta handoff.
 * The public key is supplied by the caller: this function cannot establish
 * that the signer is an OWNER-approved independent auditor. Full live-ledger
 * coverage, writer provenance and rollback are NOT established by signing.
 */
export function quoteScoutSignedBetaUnitHandoff({
  canonicalLedgerRows,
  unitAssertions,
  signatureBase64,
  signerPublicKeyPem,
  accounts,
  betaThresholdRows,
  formalReleaseAtMs
} = {}) {
  let manifest;
  try {
    manifest = buildScoutBetaUnitManifestMessage({
      canonicalLedgerRows,
      unitAssertions
    });
  } catch {
    return hold('unit_evidence_manifest_invalid_hold');
  }
  let valid = false;
  try {
    if (
      typeof signatureBase64 !== 'string' ||
      !/^[a-zA-Z0-9+/]+={0,2}$/.test(signatureBase64)
    )
      return hold('unit_evidence_signature_invalid_hold');
    const signature = Buffer.from(signatureBase64, 'base64');
    if (
      signature.length !== 64 ||
      signature.toString('base64') !== signatureBase64
    )
      return hold('unit_evidence_signature_invalid_hold');
    const signer = createPublicKey(signerPublicKeyPem);
    valid =
      signer.asymmetricKeyType === 'ed25519' &&
      verify(
        null,
        Buffer.from(manifest.message, 'utf8'),
        signer,
        signature
      );
  } catch {
    valid = false;
  }
  if (!valid) return hold('unit_evidence_signature_invalid_hold');
  const unitsById = new Map(
    unitAssertions.map((assertion) => [
      assertion.ledgerId,
      assertion.sourceUnitVersion
    ])
  );
  const sourceRows = canonicalLedgerRows.map((row) => ({
    ...row,
    sourceUnitVersion: unitsById.get(row.id)
  }));
  const handoff = quoteScoutOfflineBetaHandoff({
    ledgerUnitVersion: SCOUT_MIXED_BETA_POINT_UNITS,
    canonicalLedgerRows: sourceRows,
    accounts,
    betaThresholdRows,
    formalReleaseAtMs
  });
  if (handoff.status !== 'offline_handoff_quote_only')
    return hold(handoff.status);
  return Object.freeze({
    ...handoff,
    signedManifestMessageSha256: manifest.messageSha256,
    signedManifestRowCount: manifest.rowCount,
    signatureCryptographicallyVerified: true,
    // Never elevate a self-signed or caller-selected key to live authority.
    signedIssuerAuthorized: false,
    independentLiveLedgerCensusVerified: false,
    sourceWriterVersionIndependentlyVerified: false,
    readyForRealCutover: false,
    mayMigrateDb: false,
    mayIssuePoints: false,
    mayRedeem: false
  });
}
