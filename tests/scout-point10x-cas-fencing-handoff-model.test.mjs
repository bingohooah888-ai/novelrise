import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNER_LOGIN,
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  SOURCE_RPC_SHA256,
  FIXED_CANDIDATE_RPC_SHA256
} from '../scripts/scout-point10x-atomic-staging-plan.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  MARKER_SQL_SHA256
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from '../scripts/scout-point10x-durable-fence-model.mjs';
import { RECOVERY_WRITER_CLASSES } from '../scripts/scout-point10x-recovery-drain-model.mjs';
import {
  TRUSTED_MAIN_HANDOFF_REQUIREMENTS,
  REQUIRED_PRIVILEGED_PATHS,
  SINGLE_USE_CONSTRAINTS,
  UNSUPPORTED_REAL_ADAPTERS,
  newOfflineCasJournal,
  simulateOfflineAtomicOwnerClaim,
  simulateOfflineFenceAllWriters,
  inspectOfflineWriterAttempt,
  simulateOfflineAmbiguousAck,
  inspectOfflineTrustedMainHandoff
} from '../scripts/scout-point10x-cas-fencing-handoff-model.mjs';

const MAIN = 'a'.repeat(40),
  HEAD = 'b'.repeat(40),
  DIGEST = 'c'.repeat(64);
const req = () => ({
  scope: ATOMIC_PROOF_SCOPE,
  mode: APPROVAL_MODES.proof,
  mainSha: MAIN,
  candidateSha: HEAD,
  stagingRef: STAGING_PROJECT,
  operationId: 'phase08-fence-commit-0001',
  sourceSnapshotSha256: DIGEST,
  markerSqlSha256: MARKER_SQL_SHA256,
  legacyRpcSha256: SOURCE_RPC_SHA256,
  candidateRpcSha256: FIXED_CANDIDATE_RPC_SHA256
});
const owner = () => ({
  authenticatedByTrustedMainInFixture: true,
  owner: OWNER_LOGIN,
  issueNumber: 294,
  issueTitle: '[Staging Control] Supabase migration sync',
  ownerEventIsFreshInFixture: true,
  issueHistoryCompleteInFixture: true,
  mainSha: MAIN,
  candidateSha: HEAD,
  dedicatedStagingRef: STAGING_PROJECT,
  primaryCasMayCommitInFixture: true,
  secretsRead: false,
  sharedDomainUncontendedInFixture: true
});
const claim = (change = {}) =>
  simulateOfflineAtomicOwnerClaim({
    journal: newOfflineCasJournal(),
    request: req(),
    commentId: 8801,
    runId: 1001,
    expectedVersion: 0,
    expectedEpoch: 0,
    ownerFixture: owner(),
    ...change
  });
const writers = (epoch = 1) =>
  RECOVERY_WRITER_CLASSES.map((kind) => ({
    kind,
    paused: true,
    admissionClosed: true,
    dataPlaneEpoch: epoch,
    oldTokenRejected: true,
    active: 0,
    inflight: 0,
    queued: 0,
    retry: 0,
    unacked: 0,
    outbox: 0
  }));
const privileged = () =>
  REQUIRED_PRIVILEGED_PATHS.map((path) => ({
    path,
    dbEnforced: true,
    bypassImpossible: true,
    oldEpochRejected: true
  }));
const fence = (change = {}) =>
  simulateOfflineFenceAllWriters({
    journal: claim().journal,
    runId: 1001,
    epoch: 1,
    writerEvidence: writers(),
    privilegedEvidence: privileged(),
    ...change
  });
const inert = (r) => {
  assert.equal(r.evidenceLevel, 'offline_untrusted_fixture');
  assert.equal(r.linearizableStoreConnected, false);
  assert.equal(r.dataPlaneFenceInstalled, false);
  assert.equal(r.trustedMainExecutorRunning, false);
  assert.equal(r.actualApprovalConsumed, false);
  for (const k of [
    'canIssueApproval',
    'canReadSecrets',
    'canCreateGithubClaim',
    'canCommitSql',
    'canRunStaging',
    'canWriteDb',
    'canChangeProduction',
    'canMergeMain',
    'canDeploy'
  ])
    assert.equal(r[k], false, k);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.blockers));
};
const blocked = (r, code) => {
  assert.ok(
    r.blockers.includes(code),
    r.status + ': expected ' + code + ' got ' + r.blockers.join(',')
  );
  inert(r);
};
test('immutable contract includes exact named critical resources', () => {
  assert.equal(TRUSTED_MAIN_HANDOFF_REQUIREMENTS.length, 10);
  assert.equal(SINGLE_USE_CONSTRAINTS.length, 6);
  assert.equal(REQUIRED_PRIVILEGED_PATHS.length, 5);
  assert.equal(UNSUPPORTED_REAL_ADAPTERS.length, 6);
  for (const a of [
    TRUSTED_MAIN_HANDOFF_REQUIREMENTS,
    SINGLE_USE_CONSTRAINTS,
    REQUIRED_PRIVILEGED_PATHS,
    UNSUPPORTED_REAL_ADAPTERS
  ])
    assert.ok(Object.isFrozen(a));
});
test('new journal is empty, immutable and shares legacy mutation domain', () => {
  const j = newOfflineCasJournal();
  assert.equal(j.domain, MUTATION_DOMAIN);
  assert.equal(j.epoch, 0);
  assert.equal(j.version, 0);
  assert.equal(j.spent.length, 0);
  assert.equal(j.active, null);
  assert.equal(j.ambiguous, false);
  assert.ok(Object.isFrozen(j));
});
test('first symbolic CAS consumes approval BEFORE GitHub CLAIMED', () => {
  const r = claim();
  assert.equal(r.status, 'SYMBOLIC_CAS_SPENT_NOT_REAL');
  assert.equal(r.journal.version, 1);
  assert.equal(r.journal.epoch, 1);
  assert.equal(r.journal.spent.length, 1);
  assert.equal(r.journal.active.runId, 1001);
  assert.equal(r.hypotheticalEpoch, 1);
  assert.equal(r.approvalStillNotAuthenticated, true);
  inert(r);
});
test('same approval cannot be consumed twice even when head is unchanged', () => {
  const a = claim(),
    b = claim({
      journal: a.journal,
      expectedVersion: 1,
      expectedEpoch: 1,
      runId: 2002
    });
  blocked(b, 'another_claim_owns_shared_domain');
  blocked(b, 'already_spent_or_scope_head_reused');
});
test('two competitors reading same version cannot both consume', () => {
  const a = claim(),
    b = claim({
      journal: a.journal,
      runId: 2002,
      expectedVersion: 0,
      expectedEpoch: 0
    });
  blocked(b, 'stale_version_or_epoch');
});
test('scopes do not borrow approval from old rollback-only scope', () => {
  const o = req();
  o.scope = 'reader-reward-beta-point-10x-staging';
  blocked(claim({ request: o }), 'invalid_or_replayed_scope_request');
});
test('persist scope has distinct mode, but no permission to execute', () => {
  const p = req();
  p.scope = ATOMIC_WRITE_SCOPE;
  p.mode = APPROVAL_MODES.persist;
  const r = claim({ request: p });
  assert.equal(r.status, 'SYMBOLIC_CAS_SPENT_NOT_REAL');
  inert(r);
});
test('scope/mode mismatch is refused', () => {
  blocked(
    claim({ request: { ...req(), scope: ATOMIC_WRITE_SCOPE } }),
    'invalid_or_replayed_scope_request'
  );
});
test('Production project never passes even with forged flags', () => {
  blocked(
    claim({ request: { ...req(), stagingRef: PRODUCTION_PROJECT } }),
    'invalid_or_replayed_scope_request'
  );
});
for (const [key, val] of [
  ['mainSha', 'x'],
  ['candidateSha', 'y'],
  ['operationId', 'short'],
  ['sourceSnapshotSha256', 'z'],
  ['markerSqlSha256', 'f'.repeat(64)],
  ['legacyRpcSha256', 'f'.repeat(64)],
  ['candidateRpcSha256', 'f'.repeat(64)]
])
  test('pinned request field modification denied: ' + key, () => {
    blocked(
      claim({ request: { ...req(), [key]: val } }),
      'invalid_or_replayed_scope_request'
    );
  });
for (const [name, mut] of [
  ['not owner', { owner: 'random-user' }],
  ['wrong issue', { issueNumber: 188 }],
  ['wrong issue title', { issueTitle: 'Other' }],
  [
    'owner authentication false',
    { authenticatedByTrustedMainInFixture: false }
  ],
  ['stale event', { ownerEventIsFreshInFixture: false }],
  ['incomplete pages', { issueHistoryCompleteInFixture: false }],
  ['main drift', { mainSha: 'f'.repeat(40) }],
  ['head drift', { candidateSha: 'f'.repeat(40) }],
  ['wrong target', { dedicatedStagingRef: PRODUCTION_PROJECT }],
  ['CAS unavailable', { primaryCasMayCommitInFixture: false }],
  ['secret read early', { secretsRead: true }],
  ['domain busy', { sharedDomainUncontendedInFixture: false }]
])
  test('reject untrusted OWNER evidence: ' + name, () => {
    blocked(
      claim({ ownerFixture: { ...owner(), ...mut } }),
      'not_authenticated_real_owner_evidence'
    );
  });
test('comment ID or run ID must be positive', () => {
  blocked(claim({ commentId: 0 }), 'invalid_comment_or_run');
  blocked(claim({ runId: -3 }), 'invalid_comment_or_run');
});
test('corrupt journal cannot grant CAS', () => {
  blocked(
    claim({ journal: { ...newOfflineCasJournal(), domain: 'other' } }),
    'invalid_journal'
  );
});
test('old epoch with a current version is still denied', () => {
  blocked(claim({ expectedEpoch: 1 }), 'stale_version_or_epoch');
});
test('a fully claimed symbolic domain cannot be fenced by a stale runner', () => {
  blocked(fence({ runId: 2222 }), 'claim_or_epoch_mismatch');
  blocked(fence({ epoch: 2 }), 'claim_or_epoch_mismatch');
});
test('all nine Writer classes and all privileged paths give symbolic FENCED, never real', () => {
  const r = fence();
  assert.equal(r.status, 'SYMBOLIC_ALL_FENCED_NOT_REAL');
  assert.equal(r.journal.blockedWriters.length, 9);
  assert.equal(r.cannotTurnThisIntoRealDbGuard, true);
  inert(r);
});
test('missing Writer class blocks global fence', () => {
  const f = writers().slice(1);
  blocked(fence({ writerEvidence: f }), 'incomplete_writer_inventory');
});
test('extra Writer class must not be silently skipped', () => {
  blocked(
    fence({ writerEvidence: [...writers(), { kind: 'another' }] }),
    'incomplete_writer_inventory'
  );
});
test('duplicate Writer class blocks', () => {
  const w = writers();
  w[0] = { ...w[1] };
  blocked(fence({ writerEvidence: w }), 'incomplete_writer_inventory');
});
for (const kind of RECOVERY_WRITER_CLASSES) {
  test('not paused writer blocks: ' + kind, () => {
    const w = writers(),
      i = w.findIndex((x) => x.kind === kind);
    w[i].paused = false;
    blocked(fence({ writerEvidence: w }), 'not_drained_or_fenced:' + kind);
  });
}
for (const field of ['admissionClosed', 'oldTokenRejected']) {
  test('missing per-writer gate blocks: ' + field, () => {
    const w = writers();
    w[0][field] = false;
    blocked(
      fence({ writerEvidence: w }),
      'not_drained_or_fenced:' + RECOVERY_WRITER_CLASSES[0]
    );
  });
}
for (const field of [
  'active',
  'inflight',
  'queued',
  'retry',
  'unacked',
  'outbox'
]) {
  test('nonzero ' + field + ' prevents fence claim', () => {
    const w = writers();
    w[0][field] = 1;
    blocked(
      fence({ writerEvidence: w }),
      'not_drained_or_fenced:' + RECOVERY_WRITER_CLASSES[0]
    );
  });
}
test('old data-plane epoch blocks even if all jobs drained', () => {
  const w = writers();
  w[3].dataPlaneEpoch = 0;
  blocked(
    fence({ writerEvidence: w }),
    'not_drained_or_fenced:' + RECOVERY_WRITER_CLASSES[3]
  );
});
test('missing privileged path blocks even if nine classes pass', () => {
  blocked(
    fence({ privilegedEvidence: privileged().slice(1) }),
    'privileged_writer_path_inventory_incomplete'
  );
});
for (const path of REQUIRED_PRIVILEGED_PATHS) {
  test('privileged path must be DB enforced: ' + path, () => {
    const arr = privileged();
    arr.find((x) => x.path === path).dbEnforced = false;
    blocked(
      fence({ privilegedEvidence: arr }),
      'privileged_path_unfenced:' + path
    );
  });
  test('privileged path cannot bypass fence: ' + path, () => {
    const arr = privileged();
    arr.find((x) => x.path === path).bypassImpossible = false;
    blocked(
      fence({ privilegedEvidence: arr }),
      'privileged_path_unfenced:' + path
    );
  });
  test('privileged path must reject old epoch: ' + path, () => {
    const arr = privileged();
    arr.find((x) => x.path === path).oldEpochRejected = false;
    blocked(
      fence({ privilegedEvidence: arr }),
      'privileged_path_unfenced:' + path
    );
  });
}
test('unrecognized future privilege path cannot silently expand inventory', () => {
  blocked(
    fence({
      privilegedEvidence: [
        ...privileged(),
        {
          path: 'new_secret_system',
          dbEnforced: true,
          bypassImpossible: true,
          oldEpochRejected: true
        }
      ]
    }),
    'privileged_writer_path_inventory_incomplete'
  );
});
test('offline writer attempt is NEVER permitted even with valid token', () => {
  const r = inspectOfflineWriterAttempt({
    journal: fence().journal,
    writerKind: RECOVERY_WRITER_CLASSES[0],
    runId: 1001,
    epoch: 1,
    dbFenced: true,
    requiresBypass: false
  });
  assert.equal(r.status, 'NO_WRITER_ADMISSION_OFFLINE');
  assert.equal(r.blockers.length, 0);
  inert(r);
});
test('stale token must be refused', () => {
  blocked(
    inspectOfflineWriterAttempt({
      journal: fence().journal,
      writerKind: RECOVERY_WRITER_CLASSES[0],
      runId: 1001,
      epoch: 0,
      dbFenced: true
    }),
    'stale_or_unknown_fence_epoch'
  );
});
test('service-role bypass must be refused regardless of token', () => {
  blocked(
    inspectOfflineWriterAttempt({
      journal: fence().journal,
      writerKind: 'direct_service_role_and_privileged_rpcs',
      runId: 1001,
      epoch: 1,
      dbFenced: true,
      requiresBypass: true
    }),
    'privileged_bypass_denied'
  );
});
test('no Data Plane proof means no Writer admission', () => {
  blocked(
    inspectOfflineWriterAttempt({
      journal: fence().journal,
      writerKind: RECOVERY_WRITER_CLASSES[1],
      runId: 1001,
      epoch: 1,
      dbFenced: false
    }),
    'db_fence_unproven'
  );
});
test('unknown Writer cannot become privileged by providing valid token', () => {
  blocked(
    inspectOfflineWriterAttempt({
      journal: fence().journal,
      writerKind: 'unreviewed_writer',
      runId: 1001,
      epoch: 1,
      dbFenced: true
    }),
    'unknown_writer_class'
  );
});
test('no fenced domain means no Writer admission', () => {
  blocked(
    inspectOfflineWriterAttempt({
      journal: claim().journal,
      writerKind: RECOVERY_WRITER_CLASSES[1],
      runId: 1001,
      epoch: 1,
      dbFenced: true
    }),
    'writer_fence_not_proven'
  );
});
test('lost claim acknowledgement preserves spent tombstone and prevents retry', () => {
  const c = claim();
  const r = simulateOfflineAmbiguousAck({
    journal: c.journal,
    runId: 1001,
    epoch: 1
  });
  assert.equal(r.status, 'HOLD_ACK_STATE_UNKNOWN');
  assert.equal(r.journal.ambiguous, true);
  assert.equal(r.journal.spent.length, 1);
  assert.equal(r.noAutomatedReplay, true);
  assert.equal(r.noWriterResume, true);
  inert(r);
  blocked(
    claim({
      journal: r.journal,
      expectedVersion: r.journal.version,
      expectedEpoch: r.journal.epoch,
      runId: 1002
    }),
    'prior_commit_or_ack_ambiguous'
  );
});
test('unknown COMMIT epoch cannot release an earlier claim', () => {
  const c = claim();
  blocked(
    simulateOfflineAmbiguousAck({
      journal: c.journal,
      runId: 1001,
      epoch: 2
    }),
    'claim_or_epoch_mismatch'
  );
});
test('unknown state prohibits Writer admission after otherwise valid fence', () => {
  const f = fence();
  const hold = simulateOfflineAmbiguousAck({
    journal: f.journal,
    runId: 1001,
    epoch: 1
  });
  blocked(
    inspectOfflineWriterAttempt({
      journal: hold.journal,
      writerKind: RECOVERY_WRITER_CLASSES[0],
      runId: 1001,
      epoch: 1,
      dbFenced: true
    }),
    'uncertain_commit_hold'
  );
});
test('handoff with no evidence remains blocked', () => {
  const r = inspectOfflineTrustedMainHandoff();
  assert.equal(r.blockers.length, 8);
  inert(r);
});
test('even all caller booleans true cannot connect to real backend', () => {
  const r = inspectOfflineTrustedMainHandoff({
    mainPinned: true,
    ownerEventFromTrustedMain: true,
    primaryDurableCas: true,
    allLegacyAndNewWritersFenced: true,
    dataPlanePrivilegedBypassDenied: true,
    sourceBackupIndependentlyRestored: true,
    lockDomainShared: true,
    doNotAutoRetryUnknown: true
  });
  assert.equal(r.blockers.length, 0);
  assert.equal(
    r.realProofCanOnlyComeFromSeparatelyApprovedInfrastructure,
    true
  );
  inert(r);
});
test('insecure old workflow overlap cannot pass handoff', () => {
  blocked(
    inspectOfflineTrustedMainHandoff({
      mainPinned: true,
      ownerEventFromTrustedMain: true,
      primaryDurableCas: true,
      allLegacyAndNewWritersFenced: true,
      dataPlanePrivilegedBypassDenied: true,
      sourceBackupIndependentlyRestored: true,
      lockDomainShared: false,
      doNotAutoRetryUnknown: true
    }),
    'cross_workflow_domain_not_shared'
  );
});
test('two observed runners cannot win sequential same CAS state', () => {
  let current = newOfflineCasJournal(),
    wins = 0;
  for (const [commentId, runId] of [
    [8801, 1001],
    [8802, 1002],
    [8803, 1003]
  ]) {
    const r = claim({
      journal: current,
      commentId,
      runId,
      expectedVersion: current.version,
      expectedEpoch: current.epoch
    });
    if (r.status === 'SYMBOLIC_CAS_SPENT_NOT_REAL') {
      current = r.journal;
      wins++;
    }
    inert(r);
  }
  assert.equal(wins, 1);
});
test('attempted OWNER self-assertion is not live authorization', () => {
  const r = claim();
  assert.equal(r.approvalStillNotAuthenticated, true);
  assert.equal(r.actualApprovalConsumed, false);
  assert.equal(r.linearizableStoreConnected, false);
  inert(r);
});
