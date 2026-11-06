import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  FIXED_CANDIDATE_RPC_SHA256,
  SOURCE_RPC_SHA256,
  OWNER_LOGIN
} from '../scripts/scout-point10x-atomic-staging-plan.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  MARKER_SQL_SHA256,
  WRITER_DB_RELATIONS
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import {
  MUTATION_DOMAIN,
  createScoutPoint10xSymbolicStore,
  modelScoutPoint10xDurableClaim
} from '../scripts/scout-point10x-durable-fence-model.mjs';
import {
  RECOVERY_WRITER_CLASSES,
  RECOVERY_RELATIONS,
  RECOVERY_COMMIT_STATES,
  RECOVERY_OPERATIONS,
  reviewScoutPoint10xDrain,
  reviewScoutPoint10xIndependentBackup,
  reviewScoutPoint10xRecoveryDecision
} from '../scripts/scout-point10x-recovery-drain-model.mjs';

const SHA_A = 'a'.repeat(40),
  SHA_B = 'b'.repeat(40);
const H64 = 'a'.repeat(64),
  B64 = 'b'.repeat(64);
const C64 = 'c'.repeat(64),
  D64 = 'd'.repeat(64);
const DIGESTS = () =>
  Object.fromEntries(
    RECOVERY_RELATIONS.map((relation, i) => [
      relation,
      String(i + 1).repeat(64)
    ])
  );
function request() {
  return {
    scope: ATOMIC_PROOF_SCOPE,
    mode: APPROVAL_MODES.proof,
    mainSha: SHA_A,
    candidateSha: SHA_B,
    stagingRef: STAGING_PROJECT,
    operationId: 'phase06-rollback-proof-0001',
    sourceSnapshotSha256: C64,
    markerSqlSha256: MARKER_SQL_SHA256,
    legacyRpcSha256: SOURCE_RPC_SHA256,
    candidateRpcSha256: FIXED_CANDIDATE_RPC_SHA256
  };
}
function fixture() {
  const req = request();
  const ownerEvidence = {
    owner: OWNER_LOGIN,
    issue: 294,
    ownerEventVerified: true,
    trustedMainLoaded: true,
    allIssueHistoryVerified: true,
    exclusiveDomainLockVerified: true,
    candidateDraftVerified: true,
    stagingRefVerified: true,
    freshMainSha: SHA_A,
    freshCandidateSha: SHA_B,
    stagingSecretsAlreadyRead: false
  };
  const c = modelScoutPoint10xDurableClaim({
    store: createScoutPoint10xSymbolicStore(),
    request: req,
    requestCommentId: 7801,
    runId: 3101,
    expectedVersion: 0,
    expectedEpoch: 0,
    evidence: ownerEvidence
  });
  assert.equal(c.status, 'SYMBOLIC_CAS_COMMITTED_NOT_REAL');
  const writers = RECOVERY_WRITER_CLASSES.map((kind) => ({
    kind,
    pauseRequested: true,
    pauseConfirmed: true,
    admissionClosed: true,
    active: 0,
    inflight: 0,
    queued: 0,
    unacked: 0,
    retry: 0,
    outbox: 0,
    fencingEpoch: 1,
    dataPlaneFenced: true,
    oldTokenRejected: true
  }));
  const fence = {
    mutationDomain: MUTATION_DOMAIN,
    fencingEpoch: 1,
    runId: 3101,
    dbAdvisoryOrEquivalentLockHeld: true,
    allOldAndNewWritersFencedAtDataPlane: true,
    legacySecurityDefinerWritesDenied: true,
    directServiceRoleWritesDenied: true,
    queuedEdgeCronAndRetriesRejected: true,
    noNewValidAwardsSincePause: true,
    independentReadOnlyProbes: true,
    samples: [
      { tick: 100, sequence: 55, fullRowDigest: C64 },
      { tick: 102, sequence: 55, fullRowDigest: C64 }
    ]
  };
  const backup = {
    sourceProjectRef: STAGING_PROJECT,
    sourceInstanceId: 'staging-primary-fixture-001',
    objectSha256: H64,
    manifestSha256: B64,
    fullRowDigest: C64,
    schemaDigest: D64,
    functionAclTriggerDigest: H64,
    snapshotSequence: 55,
    immutableObject: true,
    completeDatabaseDump: true,
    includesPointXpAndEventJournals: true,
    checksumVerified: true,
    tableDigests: DIGESTS()
  };
  const restore = {
    isolated: true,
    outboundAccessDisabled: true,
    realRestoreCompleted: true,
    independentVerifier: true,
    instanceId: 'cold-offline-postgres-0002',
    projectRef: 'not-any-real-supabase-project',
    restoredObjectSha256: H64,
    fullRowDigest: C64,
    schemaDigest: D64,
    functionAclTriggerDigest: H64,
    snapshotSequence: 55,
    tableDigests: DIGESTS()
  };
  const lockedSnapshot = {
    fencingEpoch: 1,
    sequence: 55,
    fullRowDigest: C64,
    schemaDigest: D64,
    functionAclTriggerDigest: H64,
    writerFenceStillHeld: true,
    independentReadOnlyObservation: true,
    tableDigests: DIGESTS()
  };
  const commit = {
    state: 'not_committed',
    fencingEpoch: 1,
    runId: 3101,
    mutationDomain: MUTATION_DOMAIN,
    readOnlyMarkerVerified: true,
    readOnlyLedgerVerified: true,
    readOnlyEventJournalVerified: true,
    independentSourceObserved: true,
    currentSourceSequence: 55,
    currentSourceFullRowDigest: C64,
    validAwardsAfterSnapshot: 0,
    validReversalsAfterSnapshot: 0,
    validXpEventsAfterSnapshot: 0,
    externalSideEffectsAfterSnapshot: 0,
    markerAbsent: true,
    cutoverJournalAbsent: true,
    postSnapshotPointLedgerUnchanged: true,
    writerFenceStillHeld: true,
    manualOwnerRestoreApproval: true
  };
  return {
    store: c.store,
    request: req,
    requestCommentId: 7801,
    runId: 3101,
    token: 1,
    writers,
    fence,
    backup,
    restore,
    lockedSnapshot,
    commit
  };
}
const failClosed = (result) => {
  assert.equal(result.proofMode, 'untrusted_offline_fixture');
  for (const field of [
    'actualWriterStopped',
    'actualBackupRestored',
    'actualCommitStateVerified',
    'actualDbFenceVerified',
    'realStagingTestCompleted',
    'ownerApprovedOperation',
    'mayReadSecrets',
    'mayPauseRealWriters',
    'mayRunStaging',
    'mayWriteDb',
    'mayRestoreDb',
    'mayResumeWriters',
    'mayPostGithubLedger',
    'mayChangeProduction',
    'mayMergeMain',
    'mayDeploy'
  ])
    assert.equal(result[field], false, field);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.blockers));
};
const blocked = (actual, reason) => {
  assert.ok(
    actual.blockers.includes(reason),
    actual.status + ': ' + reason + ' actual=' + actual.blockers.join(',')
  );
  failClosed(actual);
};
const drain = (p) => reviewScoutPoint10xDrain(p);
const copy = (p) => reviewScoutPoint10xIndependentBackup(p);
const decision = (p) => reviewScoutPoint10xRecoveryDecision(p);

test('roster and relation lists reused from pinned cutover contract', () => {
  assert.deepEqual(RECOVERY_RELATIONS, WRITER_DB_RELATIONS);
  assert.equal(RECOVERY_WRITER_CLASSES.length, 9);
  assert.equal(new Set(RECOVERY_WRITER_CLASSES).size, 9);
  assert.ok(Object.isFrozen(RECOVERY_WRITER_CLASSES));
});
test('pure fixture drain never claims actual pause', () => {
  const result = drain(fixture());
  assert.equal(result.status, 'MODEL_DRAIN_PREREQUISITES_ONLY');
  assert.equal(result.requiredWriterClasses, 9);
  assert.equal(result.actualDrainObservationCount, 0);
  failClosed(result);
});
test('pure fixture independent cold restore never claims actual restore', () => {
  const result = copy(fixture());
  assert.equal(result.status, 'MODEL_INDEPENDENT_BACKUP_PREREQUISITES_ONLY');
  assert.equal(result.requiredRelations.length, RECOVERY_RELATIONS.length);
  failClosed(result);
});
test('all-green fixture is review-only, never an executable restore', () => {
  const result = decision(fixture());
  assert.equal(result.status, 'MODEL_MANUAL_RESTORE_ELIGIBILITY_ONLY');
  assert.equal(result.manualReviewRequired, true);
  assert.equal(result.noAutomaticRestoreEvenIfAllFixtureFlagsTrue, true);
  assert.deepEqual(result.safeNextSteps, RECOVERY_OPERATIONS);
  failClosed(result);
});
test('recovery mode enums do not include retry/automatic restore', () => {
  assert.deepEqual(RECOVERY_COMMIT_STATES, [
    'not_committed',
    'committed',
    'unknown',
    'ambiguous'
  ]);
  assert.equal(RECOVERY_OPERATIONS.includes('restore_db'), false);
});
test('request proof vs persist is separately pinned by existing scope', () => {
  const p = fixture();
  p.request = {
    ...p.request,
    scope: ATOMIC_WRITE_SCOPE,
    mode: APPROVAL_MODES.persist
  };
  blocked(drain(p), 'claim_identity_or_fencing_mismatch');
});
test('old rollback-only scope cannot enter phase06', () => {
  const p = fixture();
  p.request = { ...p.request, scope: 'reader-reward-beta-point-10x-staging' };
  blocked(drain(p), 'wrong_scope_or_mode');
});
test('replayed run/comment or wrong fencing token is refused', () => {
  for (const mutation of [
    { runId: 3102 },
    { requestCommentId: 7802 },
    { token: 2 },
    { token: 0 },
    { request: { ...request(), candidateSha: SHA_A } }
  ]) {
    blocked(
      drain({ ...fixture(), ...mutation }),
      mutation.token === 0
        ? 'invalid_claim_identifiers'
        : 'claim_identity_or_fencing_mismatch'
    );
  }
});
test('missing spent tombstone is fail-closed', () => {
  const p = fixture();
  p.store = { ...p.store, spent: [] };
  blocked(drain(p), 'approval_spend_tombstone_missing');
});
test('missing claim is fail-closed', () => {
  const p = fixture();
  p.store = { ...p.store, active: null };
  blocked(drain(p), 'missing_symbolic_active_claim');
});
test('wrong Staging project cannot be used', () => {
  const p = fixture();
  p.request = { ...p.request, stagingRef: PRODUCTION_PROJECT };
  blocked(drain(p), 'not_dedicated_staging_project');
  blocked(copy(p), 'backup_wrong_staging_context');
});
for (const kind of RECOVERY_WRITER_CLASSES) {
  test('missing writer class fails closed: ' + kind, () => {
    const p = fixture();
    p.writers = p.writers.filter((w) => w.kind !== kind);
    blocked(drain(p), 'writer_roster_missing_duplicate_or_unknown');
  });
}
test('duplicated writer class fails closed', () => {
  const p = fixture();
  p.writers[0] = { ...p.writers[1] };
  blocked(drain(p), 'writer_roster_missing_duplicate_or_unknown');
});
test('unknown writer cannot replace known class', () => {
  const p = fixture();
  p.writers[0] = { ...p.writers[0], kind: 'unknown_new_writer' };
  blocked(drain(p), 'writer_roster_missing_duplicate_or_unknown');
});
for (const property of [
  'pauseRequested',
  'pauseConfirmed',
  'admissionClosed'
]) {
  test('pause proof missing: ' + property, () => {
    const p = fixture();
    p.writers[0][property] = false;
    blocked(drain(p), 'writer_pause_unverified:' + RECOVERY_WRITER_CLASSES[0]);
  });
}
for (const property of [
  'active',
  'inflight',
  'queued',
  'unacked',
  'retry',
  'outbox'
]) {
  test('nonzero residual work blocks drain: ' + property, () => {
    const p = fixture();
    p.writers[1][property] = 1;
    blocked(
      drain(p),
      'writer_not_drained:' + RECOVERY_WRITER_CLASSES[1] + ':' + property
    );
  });
  test('missing count blocks drain: ' + property, () => {
    const p = fixture();
    delete p.writers[1][property];
    blocked(
      drain(p),
      'writer_not_drained:' + RECOVERY_WRITER_CLASSES[1] + ':' + property
    );
  });
}
for (const mutation of [
  ['stale epoch', { fencingEpoch: 0 }],
  ['data plane bypass', { dataPlaneFenced: false }],
  ['old runner allowed', { oldTokenRejected: false }]
]) {
  test('per-writer fencing refuses ' + mutation[0], () => {
    const p = fixture();
    p.writers[4] = { ...p.writers[4], ...mutation[1] };
    blocked(drain(p), 'writer_fence_unverified:' + RECOVERY_WRITER_CLASSES[4]);
  });
}
const globalFenceFlags = [
  'dbAdvisoryOrEquivalentLockHeld',
  'allOldAndNewWritersFencedAtDataPlane',
  'legacySecurityDefinerWritesDenied',
  'directServiceRoleWritesDenied',
  'queuedEdgeCronAndRetriesRejected',
  'noNewValidAwardsSincePause',
  'independentReadOnlyProbes'
];
for (const field of globalFenceFlags) {
  test('global writer gate fails closed when ' + field + ' false', () => {
    const p = fixture();
    p.fence[field] = false;
    blocked(drain(p), 'fence_unverified:' + field);
  });
}
test('shared mutex wrong domain or epoch blocks drain', () => {
  for (const change of [
    { mutationDomain: 'legacy-workflow-only' },
    { fencingEpoch: 0 },
    { runId: 3102 }
  ]) {
    const p = fixture();
    p.fence = { ...p.fence, ...change };
    blocked(drain(p), 'shared_domain_fence_identity_mismatch');
  }
});
test('snapshot unstable across two independent read-only samples', () => {
  for (const change of [
    { tick: 100 },
    { sequence: 56 },
    { fullRowDigest: B64 }
  ]) {
    const p = fixture();
    p.fence.samples[1] = { ...p.fence.samples[1], ...change };
    blocked(drain(p), 'stable_independent_drain_watermark_not_proven');
  }
});
test('missing second independent observation never counts as drain', () => {
  const p = fixture();
  p.fence.samples = [p.fence.samples[0]];
  blocked(drain(p), 'stable_independent_drain_watermark_not_proven');
});
test('independent backup metadata cannot be omitted', () => {
  for (const k of ['backup', 'restore', 'lockedSnapshot']) {
    const p = fixture();
    p[k] = null;
    const r = copy(p);
    assert.equal(r.status, 'HOLD_BACKUP_RESTORE_UNPROVEN');
    failClosed(r);
  }
});
for (const mutation of [
  [
    'source project is Production',
    { sourceProjectRef: PRODUCTION_PROJECT },
    'backup_wrong_source_project'
  ],
  [
    'mutable dump',
    { immutableObject: false },
    'full_immutable_backup_unverified'
  ],
  [
    'partial dump',
    { completeDatabaseDump: false },
    'full_immutable_backup_unverified'
  ],
  [
    'event journals missing',
    { includesPointXpAndEventJournals: false },
    'full_immutable_backup_unverified'
  ],
  [
    'checksum unverified',
    { checksumVerified: false },
    'full_immutable_backup_unverified'
  ],
  [
    'bad object digest',
    { objectSha256: 'invalid' },
    'backup_digest_missing_or_invalid'
  ],
  [
    'missing manifest digest',
    { manifestSha256: null },
    'backup_digest_missing_or_invalid'
  ],
  [
    'negative snapshot sequence',
    { snapshotSequence: -1 },
    'backup_watermark_invalid'
  ]
]) {
  test('backup fail-close: ' + mutation[0], () => {
    const p = fixture();
    p.backup = { ...p.backup, ...mutation[1] };
    blocked(copy(p), mutation[2]);
  });
}
for (const mutation of [
  ['not isolated', { isolated: false }, 'isolated_restore_not_proven'],
  [
    'external network open',
    { outboundAccessDisabled: false },
    'isolated_restore_not_proven'
  ],
  [
    'restore not completed',
    { realRestoreCompleted: false },
    'isolated_restore_not_proven'
  ],
  [
    'not independently checked',
    { independentVerifier: false },
    'isolated_restore_not_proven'
  ],
  [
    'restored onto staging',
    { projectRef: STAGING_PROJECT },
    'restore_not_independent_of_staging_production'
  ],
  [
    'restored onto production',
    { projectRef: PRODUCTION_PROJECT },
    'restore_not_independent_of_staging_production'
  ],
  [
    'same instance as source',
    { instanceId: 'staging-primary-fixture-001' },
    'restore_not_independent_of_staging_production'
  ],
  [
    'tampered checksum',
    { restoredObjectSha256: B64 },
    'restored_object_checksum_mismatch'
  ],
  [
    'schema mismatch',
    { schemaDigest: H64 },
    'independent_restore_fingerprint_mismatch'
  ],
  [
    'function/ACL/trigger mismatch',
    { functionAclTriggerDigest: D64 },
    'independent_restore_fingerprint_mismatch'
  ],
  [
    'full row mismatch',
    { fullRowDigest: H64 },
    'independent_restore_fingerprint_mismatch'
  ],
  ['watermark wrong', { snapshotSequence: 99 }, 'restore_watermark_mismatch']
]) {
  test('independent restore fail-close: ' + mutation[0], () => {
    const p = fixture();
    p.restore = { ...p.restore, ...mutation[1] };
    blocked(copy(p), mutation[2]);
  });
}
for (const mutation of [
  ['stale epoch', { fencingEpoch: 0 }, 'locked_snapshot_fencing_mismatch'],
  [
    'different snapshot watermark',
    { sequence: 56 },
    'backup_does_not_match_locked_source_watermark'
  ],
  [
    'source rows drift',
    { fullRowDigest: H64 },
    'locked_source_vs_backup_snapshot_mismatch'
  ],
  [
    'writer fence lost',
    { writerFenceStillHeld: false },
    'locked_snapshot_not_independently_observed'
  ],
  [
    'source never independently observed',
    { independentReadOnlyObservation: false },
    'locked_snapshot_not_independently_observed'
  ]
]) {
  test('source locked snapshot fail-close: ' + mutation[0], () => {
    const p = fixture();
    p.lockedSnapshot = { ...p.lockedSnapshot, ...mutation[1] };
    blocked(copy(p), mutation[2]);
  });
}
for (const type of ['backup', 'restore', 'lockedSnapshot']) {
  test('omitted relation digest blocks ' + type, () => {
    const p = fixture();
    const t = { ...p[type].tableDigests };
    delete t[RECOVERY_RELATIONS[0]];
    p[type].tableDigests = t;
    blocked(copy(p), 'missing_full_relation_digests:' + type);
  });
  test('wrong relation digest blocks ' + type, () => {
    const p = fixture();
    p[type].tableDigests[RECOVERY_RELATIONS[1]] = H64;
    blocked(copy(p), 'relation_digest_drift:' + RECOVERY_RELATIONS[1]);
  });
}
test('all relation digests must be valid SHA256 and exact keys', () => {
  const p = fixture();
  p.backup.tableDigests.extra = H64;
  blocked(copy(p), 'missing_full_relation_digests:backup');
});
test('COMMIT confirmed: forward repair only, never stale restore', () => {
  const p = fixture();
  p.commit.state = 'committed';
  p.commit.markerAbsent = false;
  p.commit.cutoverJournalAbsent = false;
  const r = decision(p);
  assert.equal(r.status, 'FORWARD_REPAIR_MANUAL_REVIEW_ONLY');
  assert.equal(r.forwardRepairInsteadOfStaleRestore, true);
  blocked(r, 'already_committed_forward_repair_only');
});
for (const state of ['unknown', 'ambiguous']) {
  test('ambiguous COMMIT stays locked: ' + state, () => {
    const p = fixture();
    p.commit.state = state;
    const r = decision(p);
    assert.equal(r.status, 'HOLD_AMBIGUOUS_COMMIT');
    blocked(r, 'ambiguous_commit_hold_manual_requery');
  });
}
for (const field of [
  'validAwardsAfterSnapshot',
  'validReversalsAfterSnapshot',
  'validXpEventsAfterSnapshot',
  'externalSideEffectsAfterSnapshot'
]) {
  test('valid post-snapshot changes reject stale restore: ' + field, () => {
    const p = fixture();
    p.commit[field] = 1;
    const r = decision(p);
    assert.equal(r.status, 'HOLD_LEGITIMATE_POINT_LOSS_RISK');
    blocked(r, 'stale_backup_would_erase_valid_events_or_external_effects');
  });
}
test('stale full-row digest after apparently drained queue fails closed', () => {
  const p = fixture();
  p.fence.samples[1].fullRowDigest = H64;
  blocked(decision(p), 'drain_observation_does_not_match_locked_source');
});
test('a new source watermark blocks restoration even with zero reported Point events', () => {
  const p = fixture();
  p.commit.currentSourceSequence = 56;
  blocked(decision(p), 'pre_restore_source_snapshot_drift');
});
test('a changed source full-row fingerprint blocks restoration', () => {
  const p = fixture();
  p.commit.currentSourceFullRowDigest = H64;
  blocked(decision(p), 'pre_restore_source_snapshot_drift');
});
test('unidentified source database instance fails independent restore', () => {
  const p = fixture();
  delete p.backup.sourceInstanceId;
  blocked(copy(p), 'backup_source_instance_unidentified');
});
test('missing event counts reject stale restore', () => {
  const p = fixture();
  delete p.commit.validAwardsAfterSnapshot;
  blocked(decision(p), 'post_snapshot_event_counts_missing');
});
for (const field of [
  'readOnlyMarkerVerified',
  'readOnlyLedgerVerified',
  'readOnlyEventJournalVerified',
  'independentSourceObserved'
]) {
  test('commit journal verification required: ' + field, () => {
    const p = fixture();
    p.commit[field] = false;
    blocked(decision(p), 'commit_state_read_only_requery_incomplete');
  });
}
for (const field of [
  'markerAbsent',
  'cutoverJournalAbsent',
  'postSnapshotPointLedgerUnchanged'
]) {
  test('nonempty change marker refuses manual restore: ' + field, () => {
    const p = fixture();
    p.commit[field] = false;
    blocked(decision(p), 'cutover_marker_or_ledger_changed');
  });
}
test('writer fence expiration during restore preflight refuses', () => {
  const p = fixture();
  p.commit.writerFenceStillHeld = false;
  blocked(decision(p), 'restore_owner_and_writer_fence_review_missing');
});
test('manual OWNER restore approval must not be assumed', () => {
  const p = fixture();
  p.commit.manualOwnerRestoreApproval = false;
  blocked(decision(p), 'restore_owner_and_writer_fence_review_missing');
});
test('stale runner or token in commit journal refused', () => {
  for (const change of [
    { fencingEpoch: 2 },
    { runId: 3102 },
    { mutationDomain: 'legacy-scope' }
  ]) {
    const p = fixture();
    p.commit = { ...p.commit, ...change };
    blocked(decision(p), 'commit_journal_fencing_identity_mismatch');
  }
});
test('malformed commit state cannot authorize anything', () => {
  const p = fixture();
  p.commit.state = 'safe_to_restore';
  blocked(decision(p), 'commit_state_invalid');
});
test('null commit evidence fails closed', () => {
  const p = fixture();
  p.commit = null;
  blocked(decision(p), 'commit_resolution_missing');
});
test('backup failure dominates apparently clean commit', () => {
  const p = fixture();
  p.restore.realRestoreCompleted = false;
  const r = decision(p);
  assert.equal(r.status, 'HOLD_RECOVERY_UNPROVEN');
  blocked(r, 'isolated_restore_not_proven');
});
test('undrained retry dominates apparently perfect cold backup', () => {
  const p = fixture();
  p.writers[8].retry = 1;
  const r = decision(p);
  assert.equal(r.status, 'HOLD_RECOVERY_UNPROVEN');
  blocked(r, 'writer_not_drained:' + RECOVERY_WRITER_CLASSES[8] + ':retry');
});
