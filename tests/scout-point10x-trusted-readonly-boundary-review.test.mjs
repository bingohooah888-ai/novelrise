import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  TRUST_REVIEW_PROTOCOL,
  EVIDENCE_REVIEW_PROTOCOL,
  RECOVERY_REVIEW_PROTOCOL,
  RECOVERY_STEPS,
  RECOVERY_FAILURES,
  makeGoodBoundaryFixture,
  reviewInertExecutorBoundary,
  makeGoodEvidenceEnvelopeFixture,
  reviewInertEvidenceEnvelope,
  resealSyntheticEnvelope,
  makeGoodRecoveryFixture,
  reviewInertRecovery
} from '../scripts/scout-point10x-trusted-readonly-boundary-review.mjs';
import {
  makeInertSnapshotManifest,
  SNAPSHOT_TXN_BOUNDARY,
  REQUIRED_FAIL_CLOSED
} from '../scripts/scout-point10x-single-snapshot-review.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const b = () => clone(makeGoodBoundaryFixture());
const a = () => clone(makeGoodEvidenceEnvelopeFixture());
const r = () => clone(makeGoodRecoveryFixture());

function powerless(x) {
  assert.equal(x.decision, 'NO_GO');
  assert.equal(x.realDatabaseConnections, 0);
  assert.equal(x.sanitized, true);
  assert.equal(x.noAutomaticRetry, true);
  assert.equal(x.noAutomaticOwnerClaim, true);
  for (const k of [
    'mayConnectDb',
    'mayRunSql',
    'mayWriteDb',
    'mayClaimOwner',
    'mayUseDocker',
    'mayRunStaging',
    'mayChangeProduction',
    'mayMergeMain',
    'mayDeploy',
    'authenticatedOwner',
    'actualControlClaimed',
    'actualSpentConsumed',
    'singleRealSnapshotVerified',
    'realPrivilegedWriterFenced',
    'realSqlExecuted',
    'actualCatalogCompared',
    'actualBackupRestored'
  ])
    assert.equal(x[k], false, k);
  for (const code of REQUIRED_FAIL_CLOSED)
    assert.ok(x.blockers.includes(code), 'missing ' + code);
  assert.ok(Object.isFrozen(x));
  assert.ok(Object.isFrozen(x.blockers));
}
function passShape(x, status) {
  assert.equal(x.status, status, x.blockers.join(','));
  assert.equal(x.syntheticInvariantPass, true);
  assert.equal(x.partialResultsDiscarded, false);
  powerless(x);
}
function hold(x, reason) {
  assert.match(x.status, /^HOLD_INERT_/u);
  assert.equal(x.syntheticInvariantPass, false);
  assert.equal(x.partialResultsDiscarded, true);
  assert.ok(x.blockers.includes(reason), reason + ': ' + x.blockers.join(','));
  powerless(x);
}
test('new module is model-only and retains no operational capability', () => {
  assert.equal(TRUST_REVIEW_PROTOCOL, 'POINT10X_INERT_TRUST_BOUNDARY_V1');
  assert.equal(EVIDENCE_REVIEW_PROTOCOL, 'POINT10X_INERT_AUDIT_ENVELOPE_V1');
  assert.equal(RECOVERY_REVIEW_PROTOCOL, 'POINT10X_INERT_RECOVERY_V1');
  passShape(
    reviewInertExecutorBoundary({ fixture: b() }),
    'NO_GO_INERT_EXECUTOR_BOUNDARY'
  );
  passShape(
    reviewInertEvidenceEnvelope({ fixture: a() }),
    'NO_GO_INERT_EVIDENCE_ENVELOPE'
  );
  passShape(reviewInertRecovery({ fixture: r() }), 'NO_GO_INERT_RECOVERY');
});
test('pinned 8+3 source SQL SHA256 remains immutable', () => {
  for (const [name, digest] of [
    [
      '../docs/plans/READER-REWARD-POINT10X-STAGING-CATALOG-READONLY-20261105.sql',
      SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.base
    ],
    [
      '../docs/plans/READER-REWARD-POINT10X-STAGING-PRIVILEGED-CATALOG-ADDENDUM-20261105.sql',
      SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.addendum
    ]
  ]) {
    const bytes = readFileSync(fileURLToPath(new URL(name, import.meta.url)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  }
  assert.equal(makeInertSnapshotManifest().sectionCount, 11);
});
const cases = [
  [
    'unexpected root field',
    (f) => {
      f.credentials = 'SHOULD_NOT_USE';
    },
    'UNEXPECTED_EXECUTOR_INPUT_FIELDS'
  ],
  [
    'missing boundary protocol',
    (f) => {
      f.protocol = 'REAL_RUN';
    },
    'BOUNDARY_PROTOCOL_INVALID'
  ],
  [
    'expected main invalid',
    (f) => {
      f.expected.mainSha = 'invalid';
    },
    'EXPECTED_SHA_AND_MANIFEST_BINDING_INVALID'
  ],
  [
    'expected head invalid',
    (f) => {
      f.expected.headSha = 'invalid';
    },
    'EXPECTED_SHA_AND_MANIFEST_BINDING_INVALID'
  ],
  [
    'expected plan digest drift',
    (f) => {
      f.expected.planDigest = '0'.repeat(64);
    },
    'EXPECTED_SHA_AND_MANIFEST_BINDING_INVALID'
  ],
  [
    'owner approval impersonated',
    (f) => {
      f.owner.ownerAuthenticated = true;
    },
    'UNTRUSTED_OWNER_CANNOT_ASSERT_APPROVAL'
  ],
  [
    'owner claim impersonated',
    (f) => {
      f.owner.commentConsumed = true;
    },
    'UNTRUSTED_OWNER_CANNOT_ASSERT_APPROVAL'
  ],
  [
    'old owner scope',
    (f) => {
      f.owner.request.scope =
        'reader-reward-beta-point-10x-staging-catalog-readonly';
    },
    'OWNER_SCOPE_OR_PINNED_REQUEST_INVALID'
  ],
  [
    'owner operation incorrect',
    (f) => {
      f.owner.request.operation = 'apply-points';
    },
    'OWNER_SCOPE_OR_PINNED_REQUEST_INVALID'
  ],
  [
    'owner issue different',
    (f) => {
      f.owner.request.issueNumber = 188;
    },
    'OWNER_SCOPE_OR_PINNED_REQUEST_INVALID'
  ],
  [
    'owner main changed',
    (f) => {
      f.owner.request.mainSha = 'b'.repeat(40);
    },
    'OWNER_MAIN_HEAD_STALE_OR_UNBOUND'
  ],
  [
    'owner head changed',
    (f) => {
      f.owner.request.headSha = 'c'.repeat(40);
    },
    'OWNER_MAIN_HEAD_STALE_OR_UNBOUND'
  ],
  [
    'owner SHA malformed',
    (f) => {
      f.owner.request.headSha = 'abc';
    },
    'OWNER_SCOPE_OR_PINNED_REQUEST_INVALID'
  ],
  [
    'owner comment absent',
    (f) => {
      delete f.owner.request.commentId;
    },
    'OWNER_SCOPE_OR_PINNED_REQUEST_INVALID'
  ],
  [
    'owner supplied self proof',
    (f) => {
      f.owner.request.ownerProof = 'fake';
    },
    'OWNER_SCOPE_OR_PINNED_REQUEST_INVALID'
  ],
  [
    'control durable claim forged',
    (f) => {
      f.control.spentDurable = true;
    },
    'CONTROL_PLANE_NOT_SAFE_FOR_OFFLINE_REVIEW'
  ],
  [
    'data plane writer fence forged',
    (f) => {
      f.control.writerFenceActive = true;
    },
    'CONTROL_PLANE_NOT_SAFE_FOR_OFFLINE_REVIEW'
  ],
  [
    'wrong shared mutation domain',
    (f) => {
      f.control.domain = 'other';
    },
    'CONTROL_PLANE_NOT_SAFE_FOR_OFFLINE_REVIEW'
  ],
  [
    'negative control epoch',
    (f) => {
      f.control.epoch = -1;
    },
    'CONTROL_PLANE_NOT_SAFE_FOR_OFFLINE_REVIEW'
  ],
  [
    'control commit unknown',
    (f) => {
      f.control.commitAck = 'lost';
    },
    'CONTROL_PLANE_NOT_SAFE_FOR_OFFLINE_REVIEW'
  ],
  [
    'control real assertion',
    (f) => {
      f.control.kind = 'LIVE';
    },
    'CONTROL_PLANE_NOT_SAFE_FOR_OFFLINE_REVIEW'
  ],
  [
    'production target',
    (f) => {
      f.session.dbRef = PRODUCTION_PROJECT;
    },
    'SINGLE_READONLY_SESSION_LEAST_PRIVILEGE_NOT_MODELLED'
  ],
  [
    'second physical connection',
    (f) => {
      f.session.physicalConnections = 2;
    },
    'SINGLE_READONLY_SESSION_LEAST_PRIVILEGE_NOT_MODELLED'
  ],
  [
    'unprivileged role unverified',
    (f) => {
      f.session.role = 'service_role';
    },
    'SINGLE_READONLY_SESSION_LEAST_PRIVILEGE_NOT_MODELLED'
  ],
  [
    'broad privilege',
    (f) => {
      f.session.privilege = 'ALL';
    },
    'SINGLE_READONLY_SESSION_LEAST_PRIVILEGE_NOT_MODELLED'
  ],
  [
    'read write mode',
    (f) => {
      f.session.access = 'READ WRITE';
    },
    'SINGLE_READONLY_SESSION_LEAST_PRIVILEGE_NOT_MODELLED'
  ],
  [
    'read committed mode',
    (f) => {
      f.session.isolation = 'READ COMMITTED';
    },
    'SINGLE_READONLY_SESSION_LEAST_PRIVILEGE_NOT_MODELLED'
  ],
  [
    'no rollback',
    (f) => {
      f.session.termination = 'COMMIT';
    },
    'SINGLE_READONLY_SESSION_LEAST_PRIVILEGE_NOT_MODELLED'
  ],
  [
    'pool rebinding possible',
    (f) => {
      f.session.poolRebinding = true;
    },
    'SINGLE_READONLY_SESSION_LEAST_PRIVILEGE_NOT_MODELLED'
  ],
  [
    'secrets presented',
    (f) => {
      f.session.secretMaterialPresent = true;
    },
    'SINGLE_READONLY_SESSION_LEAST_PRIVILEGE_NOT_MODELLED'
  ],
  [
    'real connection falsely asserted',
    (f) => {
      f.session.kind = 'CONNECTED';
    },
    'SINGLE_READONLY_SESSION_LEAST_PRIVILEGE_NOT_MODELLED'
  ],
  [
    'plan sha tamper',
    (f) => {
      f.pinned.planDigest = 'f'.repeat(64);
    },
    'EXACT_ELEVEN_PINNED_STATEMENTS_REQUIRED'
  ],
  [
    'source base sha tamper',
    (f) => {
      f.pinned.originalSqlDigests.base = 'f'.repeat(64);
    },
    'EXACT_ELEVEN_PINNED_STATEMENTS_REQUIRED'
  ],
  [
    'source addendum sha tamper',
    (f) => {
      f.pinned.originalSqlDigests.addendum = 'f'.repeat(64);
    },
    'EXACT_ELEVEN_PINNED_STATEMENTS_REQUIRED'
  ],
  [
    'section omitted',
    (f) => {
      f.pinned.statementIds.pop();
    },
    'EXACT_ELEVEN_PINNED_STATEMENTS_REQUIRED'
  ],
  [
    'section order changed',
    (f) => {
      f.pinned.statementIds.reverse();
    },
    'EXACT_ELEVEN_PINNED_STATEMENTS_REQUIRED'
  ],
  [
    'statement digest changed',
    (f) => {
      f.pinned.statementDigests[4] = 'f'.repeat(64);
    },
    'EXACT_ELEVEN_PINNED_STATEMENTS_REQUIRED'
  ],
  [
    'secret evidence',
    (f) => {
      f.outputs.secretPresent = true;
    },
    'UNSANITIZED_OR_UNKNOWN_PRIVILEGED_EVIDENCE_REJECTED'
  ],
  [
    'raw row evidence',
    (f) => {
      f.outputs.rawRowDataPresent = true;
    },
    'UNSANITIZED_OR_UNKNOWN_PRIVILEGED_EVIDENCE_REJECTED'
  ],
  [
    'unknown privileged path',
    (f) => {
      f.outputs.unknownPrivilegedPaths.push('unknown_trigger');
    },
    'UNSANITIZED_OR_UNKNOWN_PRIVILEGED_EVIDENCE_REJECTED'
  ],
  [
    'false real snapshot proof',
    (f) => {
      f.outputs.snapshotProof = 'VERIFIED_REAL';
    },
    'UNSANITIZED_OR_UNKNOWN_PRIVILEGED_EVIDENCE_REJECTED'
  ],
  [
    'outputs raw payload injected',
    (f) => {
      f.outputs.rawRows = ['sensitive'];
    },
    'UNSANITIZED_OR_UNKNOWN_PRIVILEGED_EVIDENCE_REJECTED'
  ]
];
for (const [name, mutate, reason] of cases)
  test('inert boundary fail closed: ' + name, () => {
    const f = b();
    mutate(f);
    hold(reviewInertExecutorBoundary({ fixture: f }), reason);
  });
test('missing boundary input always fails with NO-GO', () =>
  hold(
    reviewInertExecutorBoundary({ fixture: null }),
    'BOUNDARY_PROTOCOL_INVALID'
  ));
test('adversarial callbacks are never invoked by proposal schema', () => {
  const f = b();
  f.networkConnection = () => {
    throw Error('MUST_NOT_CALL');
  };
  hold(
    reviewInertExecutorBoundary({ fixture: f }),
    'UNEXPECTED_EXECUTOR_INPUT_FIELDS'
  );
});

test('evidence envelope binds exactly the synthetic trace', () => {
  const f = a();
  assert.equal(f.envelope.sections.length, 11);
  assert.equal(f.envelope.archiveMode, 'DIGESTS_ONLY_NO_ROWS');
  const result = reviewInertEvidenceEnvelope({ fixture: f });
  passShape(result, 'NO_GO_INERT_EVIDENCE_ENVELOPE');
  assert.equal(result.acceptedSectionCount, 11);
  assert.equal(result.auditSealIsSignature, false);
  assert.equal(result.auditDigestAuthorizesNothing, true);
  assert.equal(f.envelope.stagingRef, STAGING_PROJECT);
});
test('envelope does not copy original SQL or DB rows', () => {
  const f = a();
  assert.equal(
    f.envelope.sections.every((s) => Object.keys(s).length === 5),
    true
  );
  assert.equal(f.envelope.seal, resealSyntheticEnvelope(f));
});
const envelopeCases = [
  [
    'wrong envelope protocol',
    (f) => {
      f.envelope.protocol = 'LIVE';
    },
    'EVIDENCE_ENVELOPE_REQUIRED',
    false
  ],
  [
    'claims trustworthy record',
    (f) => {
      f.envelope.trust = 'SIGNED_BY_OWNER';
    },
    'MODEL_EVIDENCE_MUST_NOT_CLAIM_TRUSTED_ARCHIVE'
  ],
  [
    'raw archive',
    (f) => {
      f.envelope.archiveMode = 'RAW_DB_ROWS';
    },
    'MODEL_EVIDENCE_MUST_NOT_CLAIM_TRUSTED_ARCHIVE'
  ],
  [
    'unexpected root field',
    (f) => {
      f.envelope.accessToken = 'SECRET';
    },
    'UNEXPECTED_AUDIT_FIELDS_OR_RAW_PAYLOAD'
  ],
  [
    'unknown root field',
    (f) => {
      f.authenticated = true;
    },
    'UNEXPECTED_AUDIT_FIELDS_OR_RAW_PAYLOAD'
  ],
  [
    'invalid run id',
    (f) => {
      f.envelope.runId = 'actual-live-run';
    },
    'AUDIT_BINDING_MISSING_OR_STALE'
  ],
  [
    'different owner main',
    (f) => {
      f.envelope.mainSha = 'd'.repeat(40);
    },
    'ENVELOPE_NOT_BOUND_TO_MOCK_CONTROL_AND_OWNER'
  ],
  [
    'different owner head',
    (f) => {
      f.envelope.headSha = 'e'.repeat(40);
    },
    'ENVELOPE_NOT_BOUND_TO_MOCK_CONTROL_AND_OWNER'
  ],
  [
    'different owner comment',
    (f) => {
      f.envelope.commentId = 55;
    },
    'ENVELOPE_NOT_BOUND_TO_MOCK_CONTROL_AND_OWNER'
  ],
  [
    'negative control epoch',
    (f) => {
      f.envelope.controlEpoch = -1;
    },
    'AUDIT_BINDING_MISSING_OR_STALE'
  ],
  [
    'different control epoch',
    (f) => {
      f.envelope.controlEpoch = 1;
    },
    'ENVELOPE_NOT_BOUND_TO_MOCK_CONTROL_AND_OWNER'
  ],
  [
    'production db reference',
    (f) => {
      f.envelope.stagingRef = PRODUCTION_PROJECT;
    },
    'AUDIT_BINDING_MISSING_OR_STALE'
  ],
  [
    'missing session',
    (f) => {
      delete f.envelope.sessionId;
    },
    'AUDIT_TRANSACTION_CONTEXT_INVALID'
  ],
  [
    'missing transaction',
    (f) => {
      delete f.envelope.transactionId;
    },
    'AUDIT_TRANSACTION_CONTEXT_INVALID'
  ],
  [
    'missing snapshot',
    (f) => {
      delete f.envelope.snapshotId;
    },
    'AUDIT_TRANSACTION_CONTEXT_INVALID'
  ],
  [
    'wrong total count',
    (f) => {
      f.envelope.queryCount = 10;
    },
    'ELEVEN_ORDERED_AUDIT_SECTIONS_REQUIRED'
  ],
  [
    'one section missing',
    (f) => {
      f.envelope.sections.pop();
    },
    'ELEVEN_ORDERED_AUDIT_SECTIONS_REQUIRED'
  ],
  [
    'out of order section',
    (f) => {
      [f.envelope.sections[3], f.envelope.sections[4]] = [
        f.envelope.sections[4],
        f.envelope.sections[3]
      ];
    },
    'AUDIT_SECTION_INVALID_OR_UNSANITIZED'
  ],
  [
    'statement tampered',
    (f) => {
      f.envelope.sections[5].statementDigest = '0'.repeat(64);
    },
    'AUDIT_SECTION_INVALID_OR_UNSANITIZED'
  ],
  [
    'raw row included',
    (f) => {
      f.envelope.sections[2].rows = ['PRIVATE'];
    },
    'AUDIT_SECTION_INVALID_OR_UNSANITIZED'
  ],
  [
    'section digest malformed',
    (f) => {
      f.envelope.sections[3].resultDigest = 'broken';
    },
    'AUDIT_SECTION_INVALID_OR_UNSANITIZED'
  ],
  [
    'negative rowcount',
    (f) => {
      f.envelope.sections[3].rowCount = -1;
    },
    'AUDIT_SECTION_INVALID_OR_UNSANITIZED'
  ],
  [
    'unacknowledged rollback',
    (f) => {
      f.envelope.rollbackAck = 'unknown';
    },
    'ROLLBACK_OR_CONNECTION_CLOSE_UNCERTAIN'
  ],
  [
    'unacknowledged close',
    (f) => {
      f.envelope.closeAck = 'lost';
    },
    'ROLLBACK_OR_CONNECTION_CLOSE_UNCERTAIN'
  ],
  [
    'unknown privileged route',
    (f) => {
      f.envelope.unknownPrivilegedPaths = ['SECDEF_X'];
    },
    'UNKNOWN_PRIVILEGED_PATHS_PROHIBIT_REVIEW'
  ],
  [
    'tampered seal',
    (f) => {
      f.envelope.seal = '0'.repeat(64);
    },
    'AUDIT_COMMITMENT_MISMATCH_NOT_A_SIGNATURE'
  ],
  [
    'trace mismatch after forged envelope reseal',
    (f) => {
      f.envelope.sections[2].rowCount = 5;
      f.envelope.seal = resealSyntheticEnvelope(f);
    },
    'AUDIT_TRACE_SECTION_EVIDENCE_MISMATCH'
  ],
  [
    'trace owner scope revoked',
    (f) => {
      f.mockTrace.owner.request.scope = 'old';
    },
    'MOCK_TRACE_FAILED_OR_UNVERIFIED'
  ],
  [
    'trace second session',
    (f) => {
      f.mockTrace.events[3].sessionId = 'fixture-second';
    },
    'MOCK_TRACE_FAILED_OR_UNVERIFIED'
  ],
  [
    'trace rollback unknown',
    (f) => {
      f.mockTrace.events[13].rollbackAck = 'unknown';
    },
    'MOCK_TRACE_FAILED_OR_UNVERIFIED'
  ],
  [
    'trace close unknown',
    (f) => {
      f.mockTrace.events[14].closeAck = 'unknown';
    },
    'MOCK_TRACE_FAILED_OR_UNVERIFIED'
  ],
  [
    'trace result timeout',
    (f) => {
      f.mockTrace.events[6].status = 'timeout';
    },
    'MOCK_TRACE_FAILED_OR_UNVERIFIED'
  ]
];
for (const [name, mutate, reason, reseal = true] of envelopeCases)
  test('evidence proof fail closed: ' + name, () => {
    const f = a();
    mutate(f);
    if (reseal && reason !== 'AUDIT_COMMITMENT_MISMATCH_NOT_A_SIGNATURE')
      f.envelope.seal = resealSyntheticEnvelope(f);
    const result = reviewInertEvidenceEnvelope({ fixture: f });
    hold(result, reason);
    assert.equal(result.acceptedSectionCount, 0);
  });
test('missing and malformed evidence cannot throw or authorize', () => {
  hold(
    reviewInertEvidenceEnvelope({ fixture: null }),
    'EVIDENCE_ENVELOPE_REQUIRED'
  );
  const f = a();
  f.envelope.sections = [null];
  assert.doesNotThrow(() => reviewInertEvidenceEnvelope({ fixture: f }));
  hold(
    reviewInertEvidenceEnvelope({ fixture: f }),
    'AUDIT_SECTION_INVALID_OR_UNSANITIZED'
  );
});

test('recovery clean mock still NO-GO and no auto-resume', () => {
  assert.equal(RECOVERY_STEPS.length, 8);
  const out = reviewInertRecovery({ fixture: r() });
  passShape(out, 'NO_GO_INERT_RECOVERY');
  assert.equal(out.mayReplayOperation, false);
  assert.equal(out.mayResumeClaim, false);
  assert.equal(out.mayReleaseFence, false);
  assert.equal(out.authoritativeReadbackRequired, false);
});
for (const failure of RECOVERY_FAILURES)
  test('recovery must HOLD after ' + failure, () => {
    const f = r();
    f.failure = failure;
    const out = reviewInertRecovery({ fixture: f });
    hold(out, 'INJECTED_FAILURE_MUST_HOLD');
    assert.equal(out.mayReplayOperation, false);
    if (failure === 'CONTROL_COMMIT_UNKNOWN')
      assert.equal(out.authoritativeReadbackRequired, true);
  });
const recoveryCases = [
  [
    'unknown failure',
    (f) => {
      f.failure = 'NEW_UNMODELED_FAILURE';
    },
    'UNKNOWN_FAILURE_MUST_HOLD'
  ],
  [
    'duplicate attempt',
    (f) => {
      f.attempt = 2;
    },
    'RETRY_RECONNECT_OR_OWNER_REUSE_PROHIBITED'
  ],
  [
    'reconnection',
    (f) => {
      f.reconnects = 1;
    },
    'RETRY_RECONNECT_OR_OWNER_REUSE_PROHIBITED'
  ],
  [
    'automatic retry',
    (f) => {
      f.autoRetry = true;
    },
    'RETRY_RECONNECT_OR_OWNER_REUSE_PROHIBITED'
  ],
  [
    'owner reuse',
    (f) => {
      f.ownerReused = true;
    },
    'RETRY_RECONNECT_OR_OWNER_REUSE_PROHIBITED'
  ],
  [
    'CONTROL commit lost',
    (f) => {
      f.controlCommitAck = 'lost';
    },
    'CONTROL_COMMIT_UNCERTAIN_NO_RETRY'
  ],
  [
    'CONTROL commit unknown',
    (f) => {
      f.controlCommitAck = 'unknown';
    },
    'CONTROL_COMMIT_UNCERTAIN_NO_RETRY'
  ],
  [
    'rollback ACK lost',
    (f) => {
      f.rollbackAck = 'lost';
    },
    'ROLLBACK_UNCERTAIN_DISCARD_RESULTS'
  ],
  [
    'rollback ACK unknown',
    (f) => {
      f.rollbackAck = 'unknown';
    },
    'ROLLBACK_UNCERTAIN_DISCARD_RESULTS'
  ],
  [
    'close ACK lost',
    (f) => {
      f.closeAck = 'lost';
    },
    'CLOSE_UNCERTAIN_DISCARD_RESULTS'
  ],
  [
    'raw data persisted',
    (f) => {
      f.archivedSanitizedOnly = false;
    },
    'ARCHIVE_UNSANITIZED_OR_PRIVILEGE_PATH_UNKNOWN'
  ],
  [
    'unknown role path',
    (f) => {
      f.unknownPrivilegedPaths = ['service_role_writer'];
    },
    'ARCHIVE_UNSANITIZED_OR_PRIVILEGE_PATH_UNKNOWN'
  ],
  [
    'fake authority readback',
    (f) => {
      f.controlReadback = 'DONE';
    },
    'SELF_ASSERTED_AUTHORITATIVE_CONTROL_READBACK'
  ],
  [
    'steps reversed',
    (f) => {
      f.steps.reverse();
    },
    'RECOVERY_STEP_ORDER_OR_RUNTIME_MODE_INVALID'
  ],
  [
    'missing step',
    (f) => {
      f.steps.pop();
    },
    'RECOVERY_STEP_ORDER_OR_RUNTIME_MODE_INVALID'
  ],
  [
    'extra step',
    (f) => {
      f.steps.push('MODEL_COMMIT');
    },
    'RECOVERY_STEP_ORDER_OR_RUNTIME_MODE_INVALID'
  ],
  [
    'not offline',
    (f) => {
      f.kind = 'LIVE';
    },
    'RECOVERY_STEP_ORDER_OR_RUNTIME_MODE_INVALID'
  ],
  [
    'secret field',
    (f) => {
      f.connectionString = 'SECRET';
    },
    'UNKNOWN_RECOVERY_FIELD'
  ]
];
for (const [name, mutate, reason] of recoveryCases)
  test('recovery fail closed: ' + name, () => {
    const f = r();
    mutate(f);
    hold(reviewInertRecovery({ fixture: f }), reason);
  });
test('unknown CONTROL COMMIT and rollback ACK both require quarantine, no retry', () => {
  const f = r();
  f.controlCommitAck = 'unknown';
  f.rollbackAck = 'unknown';
  const result = reviewInertRecovery({ fixture: f });
  hold(result, 'CONTROL_COMMIT_UNCERTAIN_NO_RETRY');
  assert.equal(result.authoritativeReadbackRequired, true);
  assert.equal(result.mayReplayOperation, false);
});
test('recovery wrong protocol fails closed', () =>
  hold(
    reviewInertRecovery({ fixture: { protocol: 'LIVE' } }),
    'RECOVERY_PROTOCOL_REQUIRED'
  ));
