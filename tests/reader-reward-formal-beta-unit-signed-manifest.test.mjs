import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  fingerprintScoutBetaPointRow,
  buildScoutBetaUnitManifestMessage,
  quoteScoutSignedBetaUnitHandoff
} from '../api/_lib/reader-reward/formal-beta-unit-signed-manifest.js';
import { reconcileScoutOfflineOpening } from '../api/_lib/reader-reward/formal-cutover-offline.js';

const reader = '00000000-0000-4000-8000-000000000401';
const oldId = '00000000-0000-4000-8000-000000000411';
const reversalId = '00000000-0000-4000-8000-000000000412';
const currentId = '00000000-0000-4000-8000-000000000413';
const oldUnit = 'beta_one_point_per_yen';
const currentUnit = 'beta_ten_points_per_yen';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const signerPublicKeyPem = publicKey.export({
  type: 'spki',
  format: 'pem'
});
const release = Date.parse('2026-12-01T00:00:00.000Z');
const betaThresholdRows = Array.from({ length: 30 }, (_, index) => {
  const level = index + 1;
  return {
    level,
    cumulative_xp:
      level === 1 ? 0 : (level - 1) * 50 + 10 * (level - 2) * (level - 1),
    rule_version: 'beta-2026-09-21'
  };
});
const accounts = [
  {
    userId: reader,
    accountCreatedAtMs: Date.parse('2026-10-01T00:00:00.000Z'),
    verifiedBetaLedgerXp: 9570,
    betaSummary: {
      level: 30,
      total_xp: 9570,
      xp_into_level: 0,
      xp_for_next_level: 0,
      beta_level_max: true
    }
  }
];
const rows = [
  {
    id: oldId,
    user_id: reader,
    event_key: 'badge:old:synthetic',
    point_kind: 'badge',
    point_value: 400,
    status: 'confirmed',
    reversal_of: null
  },
  {
    id: reversalId,
    user_id: reader,
    event_key: 'reversal:old:synthetic',
    point_kind: 'adjustment',
    point_value: -25,
    status: 'confirmed',
    reversal_of: oldId
  },
  {
    id: currentId,
    user_id: reader,
    event_key: 'level_up:synthetic:30',
    point_kind: 'level_up',
    point_value: 50,
    status: 'confirmed',
    reversal_of: null
  }
];
const evidence = rows.map((row, index) => ({
  ledgerId: row.id,
  canonicalRowSha256: fingerprintScoutBetaPointRow(row),
  sourceUnitVersion: index === 2 ? currentUnit : oldUnit,
  evidenceRef: 'synthetic-writer-receipt:evt-' + (index + 1)
}));
const args = {
  canonicalLedgerRows: rows,
  unitAssertions: evidence,
  accounts,
  betaThresholdRows,
  formalReleaseAtMs: release,
  signerPublicKeyPem
};
const signed = (input = args, key = privateKey) => {
  const payload = buildScoutBetaUnitManifestMessage({
    canonicalLedgerRows: input.canonicalLedgerRows,
    unitAssertions: input.unitAssertions
  });
  return sign(null, Buffer.from(payload.message, 'utf8'), key).toString(
    'base64'
  );
};
const quote = (input = args, signature = signed()) =>
  quoteScoutSignedBetaUnitHandoff({
    ...input,
    signatureBase64: signature
  });

test('detached signature binds every economic row and explicit source unit before offline handoff', () => {
  const manifest = buildScoutBetaUnitManifestMessage({
    canonicalLedgerRows: rows,
    unitAssertions: evidence
  });
  assert.equal(manifest.rowCount, 3);
  assert.match(manifest.messageSha256, /^[a-f0-9]{64}$/);
  const reversed = buildScoutBetaUnitManifestMessage({
    canonicalLedgerRows: [...rows].reverse(),
    unitAssertions: [...evidence].reverse()
  });
  assert.equal(reversed.message, manifest.message);
  const result = quote();
  assert.equal(result.status, 'offline_handoff_quote_only');
  assert.equal(result.signatureCryptographicallyVerified, true);
  assert.equal(result.signedManifestRowCount, 3);
  assert.equal(result.signedManifestMessageSha256, manifest.messageSha256);
  assert.equal(result.walletSeeds[0].availablePoints, 3800);
  assert.equal(result.walletSeeds[0].exchangeEligiblePoints, 0);
  assert.deepEqual(
    result.convertedRows.map((row) => row.convertedValue),
    [4000, -250, 50]
  );
  assert.equal(result.signedIssuerAuthorized, false);
  assert.equal(result.independentLiveLedgerCensusVerified, false);
  assert.equal(result.sourceWriterVersionIndependentlyVerified, false);
  assert.equal(result.readyForRealCutover, false);
  assert.equal(result.mayMigrateDb, false);
  assert.equal(result.mayIssuePoints, false);
  assert.equal(result.mayRedeem, false);
  assert.equal(
    reconcileScoutOfflineOpening({
      handoff: result,
      convertedLedgerRows: result.convertedRows
    }).status,
    'offline_opening_reconciled'
  );
});

test('the original signature cannot be replayed over edited Point values, keys or unit claims', () => {
  const modifiedValue = rows.map((row) => ({ ...row }));
  modifiedValue[0].point_value = 401;
  assert.equal(
    quote({ ...args, canonicalLedgerRows: modifiedValue }).status,
    'unit_evidence_manifest_invalid_hold'
  );
  const modifiedKey = rows.map((row) => ({ ...row }));
  modifiedKey[0].event_key = 'altered:event:key';
  assert.equal(
    quote({ ...args, canonicalLedgerRows: modifiedKey }).status,
    'unit_evidence_manifest_invalid_hold'
  );
  const modifiedUnits = evidence.map((item) => ({ ...item }));
  modifiedUnits[2].sourceUnitVersion = oldUnit;
  assert.equal(
    quote({ ...args, unitAssertions: modifiedUnits }).status,
    'unit_evidence_signature_invalid_hold'
  );
  const changedReference = evidence.map((item) => ({ ...item }));
  changedReference[2].evidenceRef = 'synthetic-writer-receipt:changed';
  assert.equal(
    quote({ ...args, unitAssertions: changedReference }).status,
    'unit_evidence_signature_invalid_hold'
  );
});

test('missing or duplicate rows, unsupported versions, and forged row hashes hold', () => {
  const missing = evidence.slice(0, 2);
  assert.equal(
    quote({ ...args, unitAssertions: missing }).status,
    'unit_evidence_manifest_invalid_hold'
  );
  const dupes = evidence.map((item) => ({ ...item }));
  dupes[2].ledgerId = oldId;
  assert.equal(
    quote({ ...args, unitAssertions: dupes }).status,
    'unit_evidence_manifest_invalid_hold'
  );
  const unknown = evidence.map((item) => ({ ...item }));
  unknown[0].sourceUnitVersion = 'inferred_from_timestamp';
  assert.equal(
    quote({ ...args, unitAssertions: unknown }).status,
    'unit_evidence_manifest_invalid_hold'
  );
  const forgedHash = evidence.map((item) => ({ ...item }));
  forgedHash[1].canonicalRowSha256 = '0'.repeat(64);
  assert.equal(
    quote({ ...args, unitAssertions: forgedHash }).status,
    'unit_evidence_manifest_invalid_hold'
  );
  const changedUser = rows.map((row) => ({ ...row }));
  changedUser[0].user_id = '00000000-0000-4000-8000-000000000402';
  assert.equal(
    quote({ ...args, canonicalLedgerRows: changedUser }).status,
    'unit_evidence_manifest_invalid_hold'
  );
});

test('a self-selected or forged signing key is never independently authorized', () => {
  const other = generateKeyPairSync('ed25519');
  assert.equal(
    quote(args, signed(args, other.privateKey)).status,
    'unit_evidence_signature_invalid_hold'
  );
  assert.equal(quote(args, 'bad_signature').status, 'unit_evidence_signature_invalid_hold');
  const attackerKey = other.publicKey.export({
    type: 'spki',
    format: 'pem'
  });
  const forged = quote(
    { ...args, signerPublicKeyPem: attackerKey },
    signed(args, other.privateKey)
  );
  assert.equal(forged.status, 'offline_handoff_quote_only');
  assert.equal(forged.signedIssuerAuthorized, false);
  assert.equal(forged.independentLiveLedgerCensusVerified, false);
  assert.equal(forged.readyForRealCutover, false);
  assert.equal(forged.mayMigrateDb, false);
});

test('valid signature cannot override missing account evidence or an invalid reversal', () => {
  const noAccount = quote({ ...args, accounts: [] });
  assert.equal(noAccount.status, 'legacy_ledger_identity_or_version_invalid');
  assert.equal(noAccount.mayMigrateDb, false);
  const reversed = rows.map((row) => ({ ...row }));
  reversed[1].point_value = -401;
  const rewritten = reversed.map((row, index) => ({
    ...evidence[index],
    canonicalRowSha256: fingerprintScoutBetaPointRow(row)
  }));
  const altered = { ...args, canonicalLedgerRows: reversed, unitAssertions: rewritten };
  const result = quote(altered, signed(altered));
  assert.equal(result.status, 'legacy_reversal_exceeds_original');
  assert.equal(result.mayIssuePoints, false);
});
