import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import {
  ACCEPTANCE_PROTOCOL,
  ACCEPTANCE_GATES,
  ACCEPTANCE_PHASES,
  ACCEPTANCE_PHASE_COUNTS,
  EVIDENCE_ORIGINS,
  AUDIT_SEQUENCE,
  makeInertAcceptancePacket,
  reviewInertAcceptancePacket
} from '../scripts/scout-point10x-prestaging-acceptance-matrix.mjs';
import {
  makeInertSnapshotManifest,
  SNAPSHOT_PLAN_SCOPE,
  SNAPSHOT_TXN_BOUNDARY,
  REQUIRED_FAIL_CLOSED
} from '../scripts/scout-point10x-single-snapshot-review.mjs';
import { OWNER_CONTROL_ISSUE } from '../scripts/scout-point10x-catalog-readonly-review.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from '../scripts/scout-point10x-durable-fence-model.mjs';
import { SCOUT_POINT_10X_WRITER_CLASSES } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';
import { REQUIRED_PRIVILEGED_PATHS } from '../scripts/scout-point10x-cas-fencing-handoff-model.mjs';

const copy = () => JSON.parse(JSON.stringify(makeInertAcceptancePacket()));
const expected = () => ({
  expectedMainSha: 'a'.repeat(40),
  expectedPrHead: 'b'.repeat(40),
  expectedSqlPrHead: 'c'.repeat(40)
});
const review = (packet, values = expected()) =>
  reviewInertAcceptancePacket({ packet, ...values });
function alwaysDenied(r) {
  assert.equal(r.decision, 'NO_GO');
  assert.equal(r.readyForReadOnlyExecution, false);
  assert.equal(r.readyForCutover, false);
  assert.equal(r.allInputIsUntrusted, true);
  assert.equal(r.sourceOnly, true);
  assert.equal(r.actualOwnerAuthenticated, false);
  assert.equal(r.actualControlCasVerified, false);
  assert.equal(r.actualWriterFenced, false);
  assert.equal(r.actualBackupRestored, false);
  assert.equal(r.actualStagingSnapshotProven, false);
  assert.equal(r.realDatabaseConnections, 0);
  for (const key of [
    'mayRunSql',
    'mayConnectDb',
    'mayUseDocker',
    'mayIssueApproval',
    'mayClaimApproval',
    'mayChangeStaging',
    'mayChangeProduction',
    'mayMergeMain',
    'mayDeploy',
    'mayRetryAfterUnknownCommit'
  ])
    assert.equal(r[key], false, key);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.reasons));
  for (const b of REQUIRED_FAIL_CLOSED) assert.ok(r.reasons.includes(b), b);
}
function hold(packet, reason, values = expected()) {
  const r = review(packet, values);
  assert.equal(
    r.status,
    'HOLD_INERT_ACCEPTANCE_CONTRACT',
    JSON.stringify(r.reasons)
  );
  assert.equal(r.designShapeValid, false);
  assert.equal(r.readyForOwnerReviewOnly, false);
  assert.ok(r.reasons.includes(reason), reason + ':' + r.reasons.join(','));
  alwaysDenied(r);
}
test('well formed packet only establishes source-only acceptance design readiness', () => {
  const packet = copy(),
    r = review(packet);
  assert.equal(r.status, 'DESIGN_MATRIX_COMPLETE_NO_GO', r.reasons.join(','));
  assert.equal(r.designShapeValid, true);
  assert.equal(r.readyForOwnerReviewOnly, true);
  assert.equal(r.incompleteLiveEvidenceCount, ACCEPTANCE_GATES.length);
  assert.equal(r.gateCount, ACCEPTANCE_GATES.length);
  alwaysDenied(r);
});
test('phase separation and ordered independent evidence origins remain exhaustive', () => {
  assert.equal(
    ACCEPTANCE_PROTOCOL,
    'POINT10X_PRESTAGING_ACCEPTANCE_MATRIX_INERT_V1'
  );
  assert.deepEqual(
    [...ACCEPTANCE_PHASES],
    [
      'OFFLINE_DESIGN',
      'READONLY_ADMISSION',
      'READONLY_ACTUAL_PROOF',
      'CUTOVER_ADMISSION',
      'CUTOVER_ACTUAL_PROOF'
    ]
  );
  assert.deepEqual(
    ACCEPTANCE_PHASE_COUNTS.map((x) => x.count),
    [5, 8, 6, 9, 6]
  );
  assert.equal(ACCEPTANCE_GATES.length, 34);
  assert.equal(new Set(ACCEPTANCE_GATES.map((x) => x.id)).size, 34);
  assert.equal(
    ACCEPTANCE_GATES.every(
      (x) =>
        EVIDENCE_ORIGINS.includes(x.origin) &&
        x.acceptWhen.length > 12 &&
        x.holdWhen.length > 12
    ),
    true
  );
  assert.equal(
    ACCEPTANCE_GATES.find((x) => x.id === 'R01').phase,
    'READONLY_ADMISSION'
  );
  assert.equal(
    ACCEPTANCE_GATES.find((x) => x.id === 'C01').phase,
    'CUTOVER_ADMISSION'
  );
  assert.equal(
    ACCEPTANCE_GATES.find((x) => x.id === 'C05').origin,
    'independent_restore'
  );
  assert.equal(
    ACCEPTANCE_GATES.find((x) => x.id === 'P01').origin,
    'dedicated_staging_pg'
  );
  assert.equal(AUDIT_SEQUENCE.length, 11);
  assert.ok(
    AUDIT_SEQUENCE.indexOf(
      'perform_one_approved_readonly_snapshot_and_rollback_then_seal_evidence'
    ) <
      AUDIT_SEQUENCE.indexOf(
        'independent_cutover_security_backup_and_recovery_review'
      )
  );
  assert.equal(
    AUDIT_SEQUENCE.at(-1),
    'do_not_proceed_to_production_without_a_distinct_owner_decision'
  );
});
test('canonical context uses exact read-only scope, issue, 9 writer classes and 5 privileged paths', () => {
  const c = copy().context;
  assert.equal(c.ownerScope, SNAPSHOT_PLAN_SCOPE);
  assert.equal(c.ownerScopeState, 'NOT_REGISTERED_NOT_APPROVED');
  assert.equal(c.issueNumber, OWNER_CONTROL_ISSUE);
  assert.equal(c.prNumber, 2762);
  assert.equal(c.sqlPrNumber, 2763);
  assert.equal(c.stagingRef, STAGING_PROJECT);
  assert.notEqual(c.stagingRef, PRODUCTION_PROJECT);
  assert.equal(c.statementCount, 11);
  assert.equal(c.mutationDomain, MUTATION_DOMAIN);
  assert.equal(c.writerClassCount, SCOUT_POINT_10X_WRITER_CLASSES.length);
  assert.equal(c.privilegedPathCount, REQUIRED_PRIVILEGED_PATHS.length);
  assert.equal(c.writerClassCount, 9);
  assert.equal(c.privilegedPathCount, 5);
  assert.equal(c.planDigest, makeInertSnapshotManifest().planDigest);
});
test('original 8+3 SQL file digests are protected and not modified by reviewer', () => {
  for (const [filename, digest] of [
    [
      '../docs/plans/READER-REWARD-POINT10X-STAGING-CATALOG-READONLY-20261105.sql',
      SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.base
    ],
    [
      '../docs/plans/READER-REWARD-POINT10X-STAGING-PRIVILEGED-CATALOG-ADDENDUM-20261105.sql',
      SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.addendum
    ]
  ]) {
    const bytes = readFileSync(
      fileURLToPath(new URL(filename, import.meta.url))
    );
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  }
});
test('untrusted callers cannot provide real drivers or mutate external state', () => {
  const p = copy();
  p.connect = () => {
    throw Error('NEVER_CALL_EXTERNAL');
  };
  hold(p, 'UNKNOWN_PACKET_FIELDS');
  const r = review(copy());
  assert.equal(r.actualOwnerAuthenticated, false);
  assert.equal(r.actualControlCasVerified, false);
});
test('missing protocol / wrong packet shape holds', () => {
  hold(null, 'ACCEPTANCE_PACKET_PROTOCOL_REQUIRED');
  const wrong = copy();
  wrong.protocol = 'LIVE_ACCEPTED';
  hold(wrong, 'ACCEPTANCE_PACKET_PROTOCOL_REQUIRED');
  const extra = copy();
  extra.ownerProof = 'trusted';
  hold(extra, 'UNKNOWN_PACKET_FIELDS');
  const missing = copy();
  delete missing.context;
  hold(missing, 'CONTEXT_INCOMPLETE_OR_UNEXPECTED');
});
const headCases = [
  ['main mismatch', { expectedMainSha: 'd'.repeat(40) }],
  ['head mismatch', { expectedPrHead: 'd'.repeat(40) }],
  ['SQL PR HEAD mismatch', { expectedSqlPrHead: 'd'.repeat(40) }]
];
for (const [name, patch] of headCases)
  test('stale ref: ' + name, () => {
    hold(copy(), 'FRESH_MAIN_OR_PR_HEAD_DRIFT', { ...expected(), ...patch });
  });
for (const [name, patch] of [
  ['main invalid', { expectedMainSha: 'invalid' }],
  ['PR HEAD invalid', { expectedPrHead: 'invalid' }],
  ['SQL PR HEAD invalid', { expectedSqlPrHead: 'invalid' }]
])
  test('bad expected ref: ' + name, () => {
    hold(copy(), 'EXPECTED_HEADS_ARE_NOT_EXACT_SHA', {
      ...expected(),
      ...patch
    });
  });
for (const [key, value] of [
  ['repository', 'another/repository'],
  ['masterBlob', '0'.repeat(40)],
  ['prNumber', 123],
  ['sqlPrNumber', 2762],
  ['issueNumber', 188],
  ['stagingRef', PRODUCTION_PROJECT],
  ['ownerScope', 'legacy-scope'],
  ['ownerScopeState', 'APPROVED'],
  ['operation', 'mutation'],
  ['planDigest', '0'.repeat(64)],
  ['baseSqlSha', 'f'.repeat(64)],
  ['addendumSqlSha', 'f'.repeat(64)],
  ['statementCount', 10],
  ['mutationDomain', 'wrong-domain'],
  ['writerClassCount', 8],
  ['privilegedPathCount', 4]
])
  test('pinned context rejects ' + key, () => {
    const p = copy();
    p.context[key] = value;
    hold(p, 'PINNED_CONTEXT_DRIFT');
  });
test('context added or deleted property cannot be silently accepted', () => {
  let p = copy();
  p.context.token = 'secret';
  hold(p, 'CONTEXT_INCOMPLETE_OR_UNEXPECTED');
  p = copy();
  delete p.context.ownerScope;
  hold(p, 'CONTEXT_INCOMPLETE_OR_UNEXPECTED');
});
test('no actual evidence state is accepted in a mere source-only packet', () => {
  for (const gate of ACCEPTANCE_GATES) {
    const p = copy(),
      row = p.rows.find((x) => x.id === gate.id);
    row.evidenceState = 'PASS';
    hold(p, 'SELF_ASSERTED_EVIDENCE_CANNOT_PROVE_LIVE_READINESS');
  }
});
for (const gate of ACCEPTANCE_GATES)
  test('missing gate ' + gate.id + ' fails closed', () => {
    const p = copy();
    p.rows = p.rows.filter((r) => r.id !== gate.id);
    hold(p, 'REQUIRED_GATE_COUNT_MISMATCH');
  });
for (const gate of ACCEPTANCE_GATES)
  test('relabelled gate ' + gate.id + ' fails closed', () => {
    const p = copy();
    p.rows.find((x) => x.id === gate.id).origin = 'caller-attested-live';
    hold(p, 'GATE_ORDER_OR_TYPE_MISMATCH');
  });
for (const gate of ACCEPTANCE_GATES)
  test('fabricated artifact ' + gate.id + ' cannot prove Staging', () => {
    const p = copy();
    p.rows.find((x) => x.id === gate.id).artifactRef = 'fake-run';
    hold(p, 'SELF_ASSERTED_EVIDENCE_CANNOT_PROVE_LIVE_READINESS');
  });
test('reordered evidence sections and duplicates are rejected', () => {
  let p = copy();
  [p.rows[2], p.rows[3]] = [p.rows[3], p.rows[2]];
  hold(p, 'GATE_ORDER_OR_TYPE_MISMATCH');
  p = copy();
  p.rows[2] = { ...p.rows[3] };
  hold(p, 'GATE_ORDER_OR_TYPE_MISMATCH');
  p = copy();
  p.rows.push({ ...p.rows[0] });
  hold(p, 'REQUIRED_GATE_COUNT_MISMATCH');
});
test('evidence row extra fields, missing phase, malformed element rejected', () => {
  let p = copy();
  p.rows[4].secret = 'never';
  hold(p, 'GATE_ORDER_OR_TYPE_MISMATCH');
  p = copy();
  delete p.rows[4].phase;
  hold(p, 'GATE_ORDER_OR_TYPE_MISMATCH');
  p = copy();
  p.rows[4] = null;
  hold(p, 'GATE_ORDER_OR_TYPE_MISMATCH');
});
for (const key of Object.keys(copy().guardrails))
  test('guardrail ' + key + ' cannot become true', () => {
    const p = copy();
    p.guardrails[key] = true;
    hold(p, 'EXTERNAL_ACTION_OR_FALSE_PROOF_PROHIBITED');
  });
test('missing, unknown or malformed guardrails fail closed', () => {
  let p = copy();
  p.guardrails = null;
  hold(p, 'EXTERNAL_ACTION_OR_FALSE_PROOF_PROHIBITED');
  p = copy();
  p.guardrails.extra = true;
  hold(p, 'EXTERNAL_ACTION_OR_FALSE_PROOF_PROHIBITED');
  p = copy();
  delete p.guardrails.connectedToDb;
  hold(p, 'EXTERNAL_ACTION_OR_FALSE_PROOF_PROHIBITED');
});
test('design packet contains no living Owner, Staging or Database proof', () => {
  const p = copy(),
    before = JSON.stringify(p);
  const r = review(p);
  assert.equal(JSON.stringify(p), before);
  assert.equal(
    p.rows.every(
      (x) => x.evidenceState === 'NOT_OBSERVED' && x.artifactRef === null
    ),
    true
  );
  alwaysDenied(r);
});
