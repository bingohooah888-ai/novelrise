import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  PRIVATE_SCHEMA,
  MARKER_TABLE,
  TRUSTED_DEFINER,
  MARKER_SQL_SHA256,
  WRITER_DB_RELATIONS
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import {
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  OWNER_LOGIN,
  SOURCE_RPC_SHA256,
  FIXED_CANDIDATE_RPC_SHA256
} from '../scripts/scout-point10x-atomic-staging-plan.mjs';
import {
  createScoutPoint10xSymbolicStore,
  modelScoutPoint10xDurableClaim,
  MUTATION_DOMAIN
} from '../scripts/scout-point10x-durable-fence-model.mjs';
import { SCOUT_POINT_10X_RPC_TRIGGER } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';
import {
  POINT10X_TRANSACTION_RELATIONS,
  POINT10X_CUTOVER_STAGES,
  POINT10X_ALLOWED_COMMIT_ACK,
  POINT10X_AFFECTED_BADGES,
  POINT10X_POINT_METRIC,
  reviewScoutPoint10xAtomicUnitTransaction,
  reviewScoutPoint10xAtomicFailureMatrix
} from '../scripts/scout-point10x-atomic-unit-transaction-model.mjs';

const MAIN = 'a'.repeat(40),
  HEAD = 'b'.repeat(40);
const DIGEST = 'a'.repeat(64);
const reviewRequest = () => ({
  scope: ATOMIC_PROOF_SCOPE,
  mode: APPROVAL_MODES.proof,
  mainSha: MAIN,
  candidateSha: HEAD,
  stagingRef: STAGING_PROJECT,
  operationId: 'phase07-atomic-unit-0001',
  sourceSnapshotSha256: DIGEST,
  markerSqlSha256: MARKER_SQL_SHA256,
  legacyRpcSha256: SOURCE_RPC_SHA256,
  candidateRpcSha256: FIXED_CANDIDATE_RPC_SHA256
});
function fixture(overrideRequest) {
  const request = overrideRequest ?? reviewRequest();
  const c = modelScoutPoint10xDurableClaim({
    store: createScoutPoint10xSymbolicStore(),
    request,
    requestCommentId: 9021,
    runId: 4012,
    expectedVersion: 0,
    expectedEpoch: 0,
    evidence: {
      owner: OWNER_LOGIN,
      issue: 294,
      ownerEventVerified: true,
      trustedMainLoaded: true,
      allIssueHistoryVerified: true,
      exclusiveDomainLockVerified: true,
      candidateDraftVerified: true,
      stagingRefVerified: true,
      freshMainSha: MAIN,
      freshCandidateSha: HEAD,
      stagingSecretsAlreadyRead: false
    }
  });
  assert.equal(c.status, 'SYMBOLIC_CAS_COMMITTED_NOT_REAL');
  const snapshot = {
    sourceSequence: 55,
    fullRowDigest: DIGEST,
    currentUnit: '1pt_per_yen',
    privateMarkers: [],
    relations: {
      'public.scout_xp_ledger': [
        { id: 'xp1', event_key: 'xp:001', xp: 100, kind: 'reading' },
        { id: 'xp2', event_key: 'xp:002', xp: 50, kind: 'level_up' }
      ],
      'public.scout_point_ledger': [
        {
          id: 'p1',
          user_id: 'u1',
          event_key: 'level_up:u1:1',
          point_value: 5,
          status: 'confirmed',
          reversal_of: null,
          metadata: {}
        },
        {
          id: 'p2',
          user_id: 'u1',
          event_key: 'award:u1:2',
          point_value: 12,
          status: 'pending',
          reversal_of: null,
          metadata: {}
        },
        {
          id: 'p3',
          user_id: 'u1',
          event_key: 'reverse:u1:3',
          point_value: -5,
          status: 'reversed',
          reversal_of: 'p1',
          metadata: { note: 'test' }
        }
      ],
      'public.scout_badge_definitions': [
        {
          badge_id: 'reader_point_100',
          metric_key: POINT10X_POINT_METRIC,
          point_reward: 2,
          target_value: 100
        },
        {
          badge_id: 'reader_point_500',
          metric_key: POINT10X_POINT_METRIC,
          point_reward: 3,
          target_value: 500
        },
        {
          badge_id: 'reading_days_7',
          metric_key: 'reading_days',
          point_reward: 4,
          target_value: 7
        }
      ],
      'public.user_scout_badges': [
        {
          compoundKey: 'u1::reader_point_100',
          user_id: 'u1',
          badge_id: 'reader_point_100',
          progress_value: 81,
          unlocked: false
        },
        {
          compoundKey: 'u2::reader_point_500',
          user_id: 'u2',
          badge_id: 'reader_point_500',
          progress_value: 180,
          unlocked: true
        },
        {
          compoundKey: 'u2::reading_days_7',
          user_id: 'u2',
          badge_id: 'reading_days_7',
          progress_value: 4,
          unlocked: false
        }
      ],
      'public.scout_point_operator_actions': [
        { id: 'op1', amount: 5, category: 'grant' },
        { id: 'op2', amount: -5, category: 'reversal' },
        { id: 'op3', amount: null, category: 'audit' }
      ]
    }
  };
  const proof = {
    trustedMainPinned: true,
    ownerIssue294HistoryVerified: true,
    mainSha: MAIN,
    candidateSha: HEAD,
    dedicatedStagingRef: STAGING_PROJECT,
    drainStatus: 'MODEL_DRAIN_PREREQUISITES_ONLY',
    backupStatus: 'MODEL_INDEPENDENT_BACKUP_PREREQUISITES_ONLY',
    allWriterClassesFenced: true,
    fencingEpoch: 1,
    writerFenceHeldThroughDecision: true,
    allWriterAdmissionsClosed: true,
    dbLockIncludesXpAndFiveRelations: true,
    dbTransactionIsolation: 'serializable',
    postgresSecurityDefinerCatalogIndependentlyChecked: true,
    migrationStaticRollbackOnlyCandidateNotUsedAsCutover: true,
    eventReversalsAndStatusesReconciled: true,
    allRowAndTriggerAclRlsParityVerified: true,
    sourceFullRowDigest: DIGEST,
    sourceSequence: 55,
    pointWritesAfterSnapshot: 0,
    xpWritesAfterSnapshot: 0,
    externalSideEffectsAfterSnapshot: 0,
    privateSchema: PRIVATE_SCHEMA,
    privateMarkerTable: MARKER_TABLE,
    privateSchemaNotExposed: true,
    privateMarkerDdlSha256Verified: true,
    markerUniqueScopeTargetAndApproval: true,
    markerRoleGrantsDenied: true,
    authoritativeMarkerAbsent: true,
    rpcSignature: TRUSTED_DEFINER,
    rpcTrigger: SCOUT_POINT_10X_RPC_TRIGGER,
    oldRpcAward: 5,
    newRpcAward: 50,
    sourceRpcSha256: SOURCE_RPC_SHA256,
    candidateRpcSha256: FIXED_CANDIDATE_RPC_SHA256,
    singleAwardTokenChanged: true,
    securityDefinerPreserved: true,
    ownerAclSearchPathTriggerSame: true,
    eventKeyIdempotencyUnchanged: true,
    expectedTargetUnit: '10pt_per_yen',
    separateProductionGateRequired: true,
    explicitScopeReviewOnly: true
  };
  return { snapshot, request, claim: c, proof };
}
function review(p = fixture()) {
  return reviewScoutPoint10xAtomicUnitTransaction(p);
}
function assertNonoperative(r) {
  assert.equal(r.simulationOnly, true);
  for (const field of [
    'externallyVerified',
    'actualTransactionStarted',
    'actualMarkerInserted',
    'actualRpcReplaced',
    'actualDataChanged',
    'actualCommitConfirmed',
    'mayAccessSecrets',
    'mayPostGithubApproval',
    'mayPostClaimOrConsumed',
    'mayRunSql',
    'mayRunStaging',
    'mayWriteDb',
    'mayRestoreDb',
    'mayResumeWriters',
    'mayAlterSecurityDefiner',
    'mayChangeProduction',
    'mayMergeMain',
    'mayDeploy'
  ])
    assert.equal(r[field], false, field);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.blockers));
}
function expectBlocked(r, code) {
  assert.ok(
    r.blockers.includes(code),
    r.status + ' missing ' + code + '\nblockers: ' + r.blockers.join(',')
  );
  assertNonoperative(r);
}
test('five surfaces reuse existing locked-relation inventory', () => {
  assert.deepEqual(POINT10X_TRANSACTION_RELATIONS, WRITER_DB_RELATIONS);
  assert.equal(POINT10X_TRANSACTION_RELATIONS.length, 5);
  assert.equal(fixture().claim.store.domain, MUTATION_DOMAIN);
  assert.deepEqual(POINT10X_ALLOWED_COMMIT_ACK, [
    'confirmed',
    'rejected',
    'unknown',
    'timeout'
  ]);
  assert.equal(POINT10X_AFFECTED_BADGES.length, 2);
  assert.ok(Object.isFrozen(POINT10X_TRANSACTION_RELATIONS));
});
test('success is only a hypothetical projection, never permission', () => {
  const r = review();
  assert.equal(r.status, 'REVIEW_ONLY_ATOMIC_PROJECTION');
  assert.equal(r.transactionOutcome, 'hypothetical_only');
  assert.equal(r.genuineCommitEvidence, false);
  assert.equal(r.markerAndRpcMustShareSingleDatabaseCommit, true);
  assertNonoperative(r);
});
test('source and Point/XP projection are cloned and immutable', () => {
  const p = fixture();
  const before = JSON.parse(JSON.stringify(p.snapshot));
  const r = review(p);
  assert.deepEqual(p.snapshot, before);
  assert.deepEqual(r.baseline, before);
  assert.ok(Object.isFrozen(r.candidate));
  assert.ok(
    Object.isFrozen(r.candidate.relations['public.scout_point_ledger'][0])
  );
});
test('XP ledger remains byte-for-byte identical in the projection', () => {
  const r = review();
  assert.deepEqual(
    r.candidate.relations['public.scout_xp_ledger'],
    r.baseline.relations['public.scout_xp_ledger']
  );
});
test('all Point statuses, event keys, reversal references, metadata unchanged', () => {
  const r = review();
  const a = r.baseline.relations['public.scout_point_ledger'];
  const b = r.candidate.relations['public.scout_point_ledger'];
  assert.deepEqual(
    b.map((x) => x.point_value),
    [50, 120, -50]
  );
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].event_key, b[i].event_key);
    assert.equal(a[i].status, b[i].status);
    assert.equal(a[i].reversal_of, b[i].reversal_of);
    assert.deepEqual(a[i].metadata, b[i].metadata);
  }
});
test('badge reward x10; threshold x10 only for point metric', () => {
  const r = review();
  const b = r.candidate.relations['public.scout_badge_definitions'];
  assert.deepEqual(
    b.map((x) => x.point_reward),
    [20, 30, 40]
  );
  assert.deepEqual(
    b.map((x) => x.target_value),
    [1000, 5000, 7]
  );
  assert.deepEqual(
    b.map((x) => x.metric_key),
    [POINT10X_POINT_METRIC, POINT10X_POINT_METRIC, 'reading_days']
  );
});
test('point badge progress x10; unrelated progress preserved', () => {
  const r = review();
  const b = r.candidate.relations['public.user_scout_badges'];
  assert.deepEqual(
    b.map((x) => x.progress_value),
    [810, 1800, 4]
  );
  assert.deepEqual(
    b.map((x) => x.unlocked),
    [false, true, false]
  );
});
test('operator amount x10 with signed reversal; NULL remains NULL', () => {
  const r = review();
  assert.deepEqual(
    r.candidate.relations['public.scout_point_operator_actions'].map(
      (x) => x.amount
    ),
    [50, -50, null]
  );
});
test('unique private marker is proposed together with the 5pt→50pt RPC', () => {
  const r = review();
  const m = r.candidate.privateMarkers;
  assert.equal(m.length, 1);
  assert.equal(m[0].targetUnitVersion, '10pt_per_yen');
  assert.equal(m[0].cutoverScope, ATOMIC_PROOF_SCOPE);
  assert.equal(m[0].approvalCommentId, 9021);
  assert.equal(m[0].operationId, 'phase07-atomic-unit-0001');
  assert.equal(m[0].fencingEpoch, 1);
  assert.equal(r.candidate.rpc.sourceSha256, SOURCE_RPC_SHA256);
  assert.equal(r.candidate.rpc.targetSha256, FIXED_CANDIDATE_RPC_SHA256);
  assert.equal(r.candidate.rpc.oldAwardPoint, 5);
  assert.equal(r.candidate.rpc.newAwardPoint, 50);
  assert.equal(r.candidate.rpc.signature, TRUSTED_DEFINER);
  assert.equal(r.candidate.rpc.trigger, SCOUT_POINT_10X_RPC_TRIGGER);
  assert.equal(r.candidate.fullRowDigest, null);
  assert.equal(r.candidate.sourceSequence, null);
  assert.equal(r.candidate.postCommitFingerprintUnverified, true);
});
test('proposed preview contains no SQL and no DB credentials', () => {
  const r = review();
  assert.equal(
    JSON.stringify(r.candidate).includes('CREATE OR REPLACE FUNCTION'),
    false
  );
  assert.equal(JSON.stringify(r.candidate).includes('postgresql://'), false);
  assertNonoperative(r);
});
test('valid persistent scope still requires distinct symbolic owner approval', () => {
  const q = {
    ...reviewRequest(),
    scope: ATOMIC_WRITE_SCOPE,
    mode: APPROVAL_MODES.persist
  };
  const r = review(fixture(q));
  assert.equal(r.status, 'REVIEW_ONLY_ATOMIC_PROJECTION');
  assert.equal(r.candidate.privateMarkers[0].cutoverScope, ATOMIC_WRITE_SCOPE);
  assertNonoperative(r);
});
test('old rollback-only scope rejected even when fixture evidence is green', () => {
  const p = fixture();
  p.request.scope = 'reader-reward-beta-point-10x-staging';
  expectBlocked(review(p), 'atomic_scope_and_mode_mismatch');
});
test('scope-mode mixing rejects', () => {
  const p = fixture();
  p.request.mode = APPROVAL_MODES.persist;
  expectBlocked(review(p), 'atomic_scope_and_mode_mismatch');
});
test('request marker digest tampering refuses a simulated cutover', () => {
  const p = fixture();
  p.request.markerSqlSha256 = 'f'.repeat(64);
  expectBlocked(review(p), 'request_snapshot_marker_or_rpc_digests_unpinned');
});
test('request source RPC digest tampering refuses a simulated cutover', () => {
  const p = fixture();
  p.request.legacyRpcSha256 = 'f'.repeat(64);
  expectBlocked(review(p), 'request_snapshot_marker_or_rpc_digests_unpinned');
});
test('request candidate RPC digest tampering refuses a simulated cutover', () => {
  const p = fixture();
  p.request.candidateRpcSha256 = 'f'.repeat(64);
  expectBlocked(review(p), 'request_snapshot_marker_or_rpc_digests_unpinned');
});
test('Production ref always rejects', () => {
  const p = fixture();
  p.request.stagingRef = PRODUCTION_PROJECT;
  expectBlocked(review(p), 'exact_staging_request_and_head_required');
});
test('mutating approved HEAD invalidates claim', () => {
  const p = fixture();
  p.request.candidateSha = 'f'.repeat(40);
  expectBlocked(review(p), 'symbolic_one_shot_claim_fence_unproven');
});
test('stale main SHA rejects', () => {
  const p = fixture();
  p.proof.mainSha = 'f'.repeat(40);
  expectBlocked(review(p), 'owner_trusted_main_and_head_not_verified');
});
test('missing spent tombstone rejects', () => {
  const p = fixture();
  p.claim = {
    ...p.claim,
    store: { ...p.claim.store, spent: [] }
  };
  expectBlocked(review(p), 'symbolic_one_shot_claim_fence_unproven');
});
test('wrong fencing epoch rejects', () => {
  const p = fixture();
  p.proof.fencingEpoch = 2;
  expectBlocked(review(p), 'prior_writer_drain_and_backup_not_proven');
});
test('missing store active claim rejects', () => {
  const p = fixture();
  p.claim = { ...p.claim, store: { ...p.claim.store, active: null } };
  expectBlocked(review(p), 'symbolic_one_shot_claim_fence_unproven');
});
test('snapshot already converted cannot be multiplied twice', () => {
  const p = fixture();
  p.snapshot.currentUnit = '10pt_per_yen';
  expectBlocked(review(p), 'unknown_or_previously_converted_unit');
});
test('preexisting marker refuses double cutover', () => {
  const p = fixture();
  p.snapshot.privateMarkers.push({ cutoverScope: ATOMIC_PROOF_SCOPE });
  expectBlocked(review(p), 'marker_already_present_or_unreadable');
});
test('ledger row metadata with old unit tag blocks duplicate conversion', () => {
  const p = fixture();
  p.snapshot.relations['public.scout_point_ledger'][0].metadata.unit_version =
    '10';
  expectBlocked(review(p), 'preexisting_row_unit_marker_or_bad_metadata');
});
const proofFlags = [
  ['trustedMainPinned', 'owner_trusted_main_and_head_not_verified'],
  ['ownerIssue294HistoryVerified', 'owner_trusted_main_and_head_not_verified'],
  ['allWriterClassesFenced', 'prior_writer_drain_and_backup_not_proven'],
  [
    'writerFenceHeldThroughDecision',
    'prior_writer_drain_and_backup_not_proven'
  ],
  ['allWriterAdmissionsClosed', 'prior_writer_drain_and_backup_not_proven'],
  [
    'dbLockIncludesXpAndFiveRelations',
    'transaction_locks_and_row_integrity_not_proven'
  ],
  [
    'postgresSecurityDefinerCatalogIndependentlyChecked',
    'transaction_locks_and_row_integrity_not_proven'
  ],
  [
    'migrationStaticRollbackOnlyCandidateNotUsedAsCutover',
    'transaction_locks_and_row_integrity_not_proven'
  ],
  [
    'eventReversalsAndStatusesReconciled',
    'transaction_locks_and_row_integrity_not_proven'
  ],
  [
    'allRowAndTriggerAclRlsParityVerified',
    'transaction_locks_and_row_integrity_not_proven'
  ],
  ['privateSchemaNotExposed', 'private_marker_schema_or_uniqueness_unverified'],
  [
    'privateMarkerDdlSha256Verified',
    'private_marker_schema_or_uniqueness_unverified'
  ],
  [
    'markerUniqueScopeTargetAndApproval',
    'private_marker_schema_or_uniqueness_unverified'
  ],
  ['markerRoleGrantsDenied', 'private_marker_schema_or_uniqueness_unverified'],
  [
    'authoritativeMarkerAbsent',
    'private_marker_schema_or_uniqueness_unverified'
  ],
  ['singleAwardTokenChanged', 'exact_security_definer_rpc_parity_unverified'],
  ['securityDefinerPreserved', 'exact_security_definer_rpc_parity_unverified'],
  [
    'ownerAclSearchPathTriggerSame',
    'exact_security_definer_rpc_parity_unverified'
  ],
  [
    'eventKeyIdempotencyUnchanged',
    'exact_security_definer_rpc_parity_unverified'
  ],
  [
    'separateProductionGateRequired',
    'unit_target_or_independent_production_gate_missing'
  ],
  [
    'explicitScopeReviewOnly',
    'unit_target_or_independent_production_gate_missing'
  ]
];
for (const [flag, code] of proofFlags) {
  test('fail-close if fixture flag false: ' + flag, () => {
    const p = fixture();
    p.proof[flag] = false;
    expectBlocked(review(p), code);
  });
}
const proofFields = [
  ['drainStatus', 'UNKNOWN', 'prior_writer_drain_and_backup_not_proven'],
  ['backupStatus', 'UNKNOWN', 'prior_writer_drain_and_backup_not_proven'],
  ['sourceSequence', 56, 'source_drift_or_new_point_xp_events'],
  [
    'sourceFullRowDigest',
    'd'.repeat(64),
    'source_drift_or_new_point_xp_events'
  ],
  ['pointWritesAfterSnapshot', 1, 'source_drift_or_new_point_xp_events'],
  ['xpWritesAfterSnapshot', 1, 'source_drift_or_new_point_xp_events'],
  [
    'externalSideEffectsAfterSnapshot',
    1,
    'source_drift_or_new_point_xp_events'
  ],
  ['privateSchema', 'public', 'private_marker_schema_or_uniqueness_unverified'],
  [
    'privateMarkerTable',
    'public.marker',
    'private_marker_schema_or_uniqueness_unverified'
  ],
  [
    'rpcSignature',
    'public.evil()',
    'exact_security_definer_rpc_parity_unverified'
  ],
  [
    'rpcTrigger',
    'different_trigger',
    'exact_security_definer_rpc_parity_unverified'
  ],
  ['oldRpcAward', 6, 'exact_security_definer_rpc_parity_unverified'],
  ['newRpcAward', 500, 'exact_security_definer_rpc_parity_unverified'],
  [
    'sourceRpcSha256',
    'f'.repeat(64),
    'exact_security_definer_rpc_parity_unverified'
  ],
  [
    'candidateRpcSha256',
    'f'.repeat(64),
    'exact_security_definer_rpc_parity_unverified'
  ],
  [
    'expectedTargetUnit',
    '100pt_per_yen',
    'unit_target_or_independent_production_gate_missing'
  ],
  [
    'dbTransactionIsolation',
    'read_committed',
    'transaction_locks_and_row_integrity_not_proven'
  ]
];
for (const [key, value, code] of proofFields) {
  test('reject changed prerequisite: ' + key, () => {
    const p = fixture();
    p.proof[key] = value;
    expectBlocked(review(p), code);
  });
}
const badRows = [
  [
    'ledger positive int32 overflow',
    'public.scout_point_ledger',
    0,
    'point_value',
    214748365,
    'overflow_or_invalid_point:point_ledger.point_value'
  ],
  [
    'ledger signed int32 underflow',
    'public.scout_point_ledger',
    2,
    'point_value',
    -214748365,
    'overflow_or_invalid_point:point_ledger.point_value'
  ],
  [
    'ledger decimal',
    'public.scout_point_ledger',
    0,
    'point_value',
    2.5,
    'overflow_or_invalid_point:point_ledger.point_value'
  ],
  [
    'ledger infinity',
    'public.scout_point_ledger',
    0,
    'point_value',
    Infinity,
    'overflow_or_invalid_point:point_ledger.point_value'
  ],
  [
    'badge reward overflow',
    'public.scout_badge_definitions',
    0,
    'point_reward',
    214748365,
    'overflow_or_invalid_point:badge_definitions.point_reward'
  ],
  [
    'badge threshold unsafe',
    'public.scout_badge_definitions',
    0,
    'target_value',
    Number.MAX_SAFE_INTEGER,
    'badge_threshold_64bit_precision_unverified'
  ],
  [
    'badge progress unsafe',
    'public.user_scout_badges',
    0,
    'progress_value',
    Number.MAX_SAFE_INTEGER,
    'badge_progress_64bit_precision_unverified'
  ],
  [
    'operator positive overflow',
    'public.scout_point_operator_actions',
    0,
    'amount',
    214748365,
    'overflow_or_invalid_point:operator_actions.amount'
  ],
  [
    'operator negative overflow',
    'public.scout_point_operator_actions',
    1,
    'amount',
    -214748365,
    'overflow_or_invalid_point:operator_actions.amount'
  ]
];
for (const [name, relation, index, key, value, code] of badRows) {
  test(name + ' rejected before conversion', () => {
    const p = fixture();
    p.snapshot.relations[relation][index][key] = value;
    expectBlocked(review(p), code);
  });
}
test('unreviewed point metric badge rejects', () => {
  const p = fixture();
  p.snapshot.relations['public.scout_badge_definitions'].push({
    badge_id: 'reader_point_9000',
    metric_key: POINT10X_POINT_METRIC,
    point_reward: 1,
    target_value: 9000
  });
  expectBlocked(review(p), 'unreviewed_point_threshold_metric');
});
test('missing known table rejects', () => {
  const p = fixture();
  delete p.snapshot.relations['public.scout_xp_ledger'];
  expectBlocked(review(p), 'five_relation_set_not_exact');
});
test('an unreviewed extra table is not silently ignored', () => {
  const p = fixture();
  p.snapshot.relations['public.unknown'] = [];
  expectBlocked(review(p), 'five_relation_set_not_exact');
});
test('duplicate XP event key fails closed before any projection', () => {
  const p = fixture();
  p.snapshot.relations['public.scout_xp_ledger'][1].event_key = 'xp:001';
  expectBlocked(review(p), 'xp_event_identity_invalid_or_duplicate');
});
test('missing point event key rejects', () => {
  const p = fixture();
  p.snapshot.relations['public.scout_point_ledger'][0].event_key = '';
  expectBlocked(review(p), 'point_event_key_missing_or_duplicate');
});
test('duplicate event key rejects', () => {
  const p = fixture();
  p.snapshot.relations['public.scout_point_ledger'][1].event_key =
    'level_up:u1:1';
  expectBlocked(review(p), 'point_event_key_missing_or_duplicate');
});
test('duplicate row identity rejects', () => {
  const p = fixture();
  p.snapshot.relations['public.scout_point_ledger'][1].id = 'p1';
  expectBlocked(review(p), 'row_identity_missing_or_duplicate:points');
});
test('user badge compound key drift rejects', () => {
  const p = fixture();
  p.snapshot.relations['public.user_scout_badges'][1].compoundKey = 'bad';
  expectBlocked(review(p), 'badge_progress_identity_mismatch');
});
test('truncated event source digest rejects', () => {
  const p = fixture();
  p.snapshot.fullRowDigest = 'bad';
  expectBlocked(review(p), 'locked_source_digest_or_sequence_invalid');
});
test('unknown fault stage cannot grant approval', () => {
  const p = fixture();
  p.failAt = 'manual_recover_and_retry';
  expectBlocked(review(p), 'unknown_fault_checkpoint');
});
test('unsupported COMMIT ack cannot create a success', () => {
  const p = fixture();
  p.commitAck = 'retry';
  expectBlocked(review(p), 'invalid_commit_acknowledgement');
});
test('COMMIT rejected rolls back model, even if all earlier stages passed', () => {
  const p = fixture();
  p.commitAck = 'rejected';
  const r = review(p);
  assert.equal(r.status, 'MODEL_COMMIT_REJECTED_ROLLBACK_ONLY');
  assert.deepEqual(r.baseline, p.snapshot);
  assert.equal(r.candidate, null);
  assert.equal(r.approvalMustRemainSpent, true);
  assertNonoperative(r);
});
for (const ack of ['unknown', 'timeout']) {
  test('ambiguous COMMIT is fenced and cannot auto-retry: ' + ack, () => {
    const p = fixture();
    p.commitAck = ack;
    const r = review(p);
    assert.equal(r.status, 'HOLD_AMBIGUOUS_COMMIT_NOT_RETRYABLE');
    assert.equal(r.candidate, null);
    assert.equal(r.noAutomaticRollbackOrRetry, true);
    assert.equal(r.writerFenceMustRemainHeld, true);
    assert.equal(r.approvalMustRemainSpent, true);
    assertNonoperative(r);
  });
}
test('every one of 12 stage faults discards all projected changes', () => {
  const p = fixture();
  for (const stage of POINT10X_CUTOVER_STAGES) {
    const r = review({ ...p, failAt: stage });
    assert.equal(r.candidate, null, stage);
    assert.deepEqual(r.baseline, p.snapshot, stage);
    assert.equal(r.approvalMustRemainSpent, true);
    if (stage === 'commit_decision') {
      assert.equal(r.status, 'HOLD_AMBIGUOUS_COMMIT_NOT_RETRYABLE');
    } else {
      assert.equal(r.status, 'MODEL_ROLLBACK_AT_FAULT');
      assert.equal(r.noPartialUnitConversionVisible, true);
    }
    assertNonoperative(r);
  }
});
test('fault matrix contains each stage exactly once and never changes DB', () => {
  const p = fixture();
  const r = reviewScoutPoint10xAtomicFailureMatrix(p);
  assert.equal(r.checkpoints, 12);
  assert.equal(r.outcomes.length, POINT10X_CUTOVER_STAGES.length);
  assert.equal(
    r.outcomes.filter((x) => x.status === 'MODEL_ROLLBACK_AT_FAULT').length,
    11
  );
  assert.equal(
    r.outcomes.filter((x) => x.status === 'HOLD_AMBIGUOUS_COMMIT_NOT_RETRYABLE')
      .length,
    1
  );
  for (const entry of r.outcomes) {
    assert.equal(entry.candidate, null);
    assertNonoperative(entry);
  }
  assertNonoperative(r);
});
test('invalid snapshot type fails before synthetic transaction begins', () => {
  const p = fixture();
  p.snapshot = null;
  expectBlocked(review(p), 'snapshot_missing_or_invalid');
});
