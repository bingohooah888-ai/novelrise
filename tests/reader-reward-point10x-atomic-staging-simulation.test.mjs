import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCOUT_10X_ATOMIC_STAGES,
  SCOUT_10X_APPROVAL_MODES,
  SCOUT_10X_PRIVATE_MARKER_REQUIREMENTS,
  SCOUT_10X_REQUIRED_GATES,
  quoteScout10xStagingExecutionBoundary,
  simulateScout10xAtomicCutover,
  quoteScout10xPostCommitRecovery
} from '../api/_lib/reader-reward/point10x-atomic-staging-simulation.js';
import {
  SCOUT_POINT_10X_RPC_LEGACY_SHA256,
  SCOUT_POINT_10X_WRITER_CLASSES
} from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';

const deepCopy = (v) => JSON.parse(JSON.stringify(v));
const fixture = () => ({
  source: 'synthetic-local-only',
  unit: '1pt_per_yen',
  marker: { cutoverId: null, unit: '1pt_per_yen' },
  ledger: [
    {
      id: '1',
      eventKey: 'badge:u1:1',
      userId: 'u1',
      points: 25,
      status: 'confirmed',
      reversalOf: null
    },
    {
      id: '2',
      eventKey: 'level_up:u1:2',
      userId: 'u1',
      points: 5,
      status: 'confirmed',
      reversalOf: null
    },
    {
      id: '3',
      eventKey: 'reverse:u1:3',
      userId: 'u1',
      points: -5,
      status: 'confirmed',
      reversalOf: '2'
    },
    {
      id: '4',
      eventKey: 'pending:u2:1',
      userId: 'u2',
      points: 3,
      status: 'pending',
      reversalOf: null
    },
    {
      id: '5',
      eventKey: 'frozen:u2:2',
      userId: 'u2',
      points: 7,
      status: 'frozen',
      reversalOf: null
    },
    {
      id: '6',
      eventKey: 'cancelled:u2:3',
      userId: 'u2',
      points: 1,
      status: 'cancelled',
      reversalOf: null
    }
  ],
  badges: [
    {
      badgeId: 'reader_point_100',
      metric: 'scout_point_earned_total',
      target: 100,
      reward: 0
    },
    {
      badgeId: 'reader_point_500',
      metric: 'scout_point_earned_total',
      target: 500,
      reward: 0
    },
    {
      badgeId: 'reader_read_5',
      metric: 'completed_reads',
      target: 5,
      reward: 5
    },
    {
      badgeId: 'author_works_10',
      metric: 'author_work_count',
      target: 10,
      reward: 0
    }
  ],
  progress: [
    {
      userId: 'u1',
      badgeId: 'reader_point_100',
      value: 25,
      percent: 25,
      earned: false
    },
    {
      userId: 'u1',
      badgeId: 'reader_point_500',
      value: 25,
      percent: 5,
      earned: false
    },
    {
      userId: 'u1',
      badgeId: 'reader_read_5',
      value: 3,
      percent: 60,
      earned: false
    },
    {
      userId: 'u2',
      badgeId: 'reader_point_100',
      value: 100,
      percent: 100,
      earned: true
    }
  ],
  operatorActions: [
    { id: 'adjustment', amount: -7 },
    { id: 'null_amount', amount: null }
  ],
  xp: [
    { id: 'xp1', userId: 'u1', value: 150 },
    { id: 'xp2', userId: 'u2', value: 3 }
  ],
  rpc: {
    sourceSha256: SCOUT_POINT_10X_RPC_LEGACY_SHA256,
    points: 5,
    securityDefiner: true,
    owner: 'postgres',
    searchPath: '',
    executeAcl: ['postgres', 'service_role'],
    eventKeyPolicy: 'user-level-unique'
  }
});
const controls = () => ({
  mode: 'local-simulation',
  projectRef: 'synthetic-local-only',
  ownerScopeReviewed: true,
  independentBackupRestored: true,
  allWritersPaused: true,
  exclusiveDatabaseFence: true,
  noInflightAwards: true,
  serializableSnapshot: true,
  exactRpcDiffReviewed: true,
  privateMarkerReviewed: true,
  noExistingMarker: true,
  fullRowReconciliation: true,
  pausedWriterClasses: [...SCOUT_POINT_10X_WRITER_CLASSES],
  unknownWriters: []
});
const run = (change = {}) =>
  simulateScout10xAtomicCutover({
    snapshot: fixture(),
    controls: controls(),
    ...change
  });
const immutableProof = (r) => {
  assert.equal(r.liveStagingVerified, false);
  assert.equal(r.liveProductionVerified, false);
  assert.equal(r.independentlyAuthorized, false);
  for (const k of [
    'mayExecuteSql',
    'mayCreateMarker',
    'mayAlterRpc',
    'mayChangeStaging',
    'mayChangeProduction',
    'mayDeploy',
    'mayMergeMain',
    'mayPayReward',
    'mayRunAi'
  ]) {
    assert.equal(r[k], false, k);
  }
};
const gateValues = () => ({
  mainSha: 'a'.repeat(40),
  candidateSha: 'b'.repeat(40),
  stagingRef: 'wmlzjgvxgoyrovdhbqbg',
  issueNumber: 294,
  scope: 'reader-reward-beta-point-10x-staging',
  mode: SCOUT_10X_APPROVAL_MODES.rollbackProof,
  ownerAuthenticated: true,
  oneTimeClaimAvailable: true,
  trustedWorkflowIsOnMain: true,
  independentlyVerifiedRestore: true,
  allWritersFenced: true,
  noInflightAward: true,
  rpcSecurityReviewed: true,
  privateMarkerDdlReviewed: true,
  recoveryProcedureReviewed: true
});

test('model distinguishes a rollback-only proof from future persistent staging approval', () => {
  assert.notEqual(
    SCOUT_10X_APPROVAL_MODES.rollbackProof,
    SCOUT_10X_APPROVAL_MODES.persistentStaging
  );
});
test('existing rollback-only path cannot authorize persistent stage mutations', () => {
  const x = quoteScout10xStagingExecutionBoundary(gateValues());
  assert.equal(x.existingRollbackOnlyScopeCanPersist, false);
  assert.equal(x.status, 'caller_asserted_dependencies_only_not_authorization');
  immutableProof(x);
});
test('no SHA or no known OWNER approval fails closed', () => {
  const x = quoteScout10xStagingExecutionBoundary();
  assert.equal(x.status, 'pre_execution_dependencies_unverified_hold');
  assert.ok(x.missing.includes('fresh_distinct_main_and_candidate_sha'));
  immutableProof(x);
});
test('candidate SHA equal to latest main cannot be accepted', () => {
  const f = gateValues();
  f.candidateSha = f.mainSha;
  assert.ok(
    quoteScout10xStagingExecutionBoundary(f).missing.includes(
      'fresh_distinct_main_and_candidate_sha'
    )
  );
});
test('wrong project or scope cannot be accepted', () => {
  for (const override of [
    { stagingRef: 'fiepaguycecrredwrcwx' },
    { issueNumber: 188 },
    { scope: 'migration-sync' }
  ]) {
    assert.equal(
      quoteScout10xStagingExecutionBoundary({ ...gateValues(), ...override })
        .status,
      'pre_execution_dependencies_unverified_hold'
    );
  }
});
test('persistent-mode string cannot substitute for reviewed separate approval', () => {
  assert.equal(
    quoteScout10xStagingExecutionBoundary({
      ...gateValues(),
      mode: 'persistent'
    }).status,
    'pre_execution_dependencies_unverified_hold'
  );
  const x = quoteScout10xStagingExecutionBoundary({
    ...gateValues(),
    mode: SCOUT_10X_APPROVAL_MODES.persistentStaging
  });
  immutableProof(x);
  assert.equal(x.requiresSeparateStagingWriteApproval, true);
});
test('trusted workflow must already be on main', () => {
  const x = quoteScout10xStagingExecutionBoundary({
    ...gateValues(),
    trustedWorkflowIsOnMain: false
  });
  assert.ok(x.missing.includes('trusted_main_workflow_unavailable'));
});
test('independent backup and restore is a hard prerequisite', () => {
  const x = quoteScout10xStagingExecutionBoundary({
    ...gateValues(),
    independentlyVerifiedRestore: false
  });
  assert.ok(x.missing.includes('backup_restore_evidence'));
});
test('writer drain and zero inflight are separately mandatory', () => {
  for (const ch of [{ allWritersFenced: false }, { noInflightAward: false }]) {
    const x = quoteScout10xStagingExecutionBoundary({ ...gateValues(), ...ch });
    assert.ok(x.missing.includes('full_writer_fence_and_drain'));
  }
});
test('SECURITY DEFINER parity, private marker and recovery plan gate separately', () => {
  for (const [k, expected] of [
    ['rpcSecurityReviewed', 'security_definer_parity'],
    ['privateMarkerDdlReviewed', 'private_unique_marker'],
    ['recoveryProcedureReviewed', 'safe_postcommit_recovery']
  ]) {
    assert.ok(
      quoteScout10xStagingExecutionBoundary({
        ...gateValues(),
        [k]: false
      }).missing.includes(expected)
    );
  }
});
test('private marker is proposed only; client access is forbidden by design', () => {
  assert.equal(
    SCOUT_10X_PRIVATE_MARKER_REQUIREMENTS.createdInAnyDatabase,
    false
  );
  assert.equal(
    SCOUT_10X_PRIVATE_MARKER_REQUIREMENTS.exposedToAnonOrAuthenticated,
    false
  );
  assert.equal(SCOUT_10X_PRIVATE_MARKER_REQUIREMENTS.restrictedDdlAndDml, true);
});
test('required review gates include privilege parity, marker and recovery', () => {
  for (const fragment of [
    'security_definer',
    'marker',
    'backup',
    'writer',
    'recovery',
    'production'
  ]) {
    assert.ok(SCOUT_10X_REQUIRED_GATES.some((g) => g.includes(fragment)));
  }
});
test('local simulation never claims a live transaction even on success', () => {
  const x = run();
  assert.equal(x.status, 'synthetic_atomic_transition_demonstrated_only');
  assert.equal(x.simulatedCommit, true);
  assert.equal(x.committedToAnyDatabase, false);
  assert.equal(x.markerWasCreatedInRealDb, false);
  immutableProof(x);
});
test('Point values multiply exactly tenfold including negative reversal', () => {
  const x = run();
  assert.deepEqual(
    x.after.ledger.map((r) => r.points),
    [250, 50, -50, 30, 70, 10]
  );
});
test('Point statuses and reversal references remain unchanged', () => {
  const x = run();
  assert.deepEqual(
    x.after.ledger.map((r) => [r.status, r.reversalOf]),
    x.before.ledger.map((r) => [r.status, r.reversalOf])
  );
});
test('event keys, user IDs, row IDs and XP are unchanged', () => {
  const x = run();
  assert.deepEqual(
    x.after.ledger.map((r) => [r.id, r.eventKey, r.userId]),
    x.before.ledger.map((r) => [r.id, r.eventKey, r.userId])
  );
  assert.deepEqual(x.after.xp, x.before.xp);
});
test('all badge reward values scale, not badge completion requirements', () => {
  const x = run();
  assert.deepEqual(
    x.after.badges.map((r) => r.reward),
    [0, 0, 50, 0]
  );
  assert.equal(
    x.after.badges.find((r) => r.badgeId === 'reader_read_5').target,
    5
  );
});
test('only Point metric milestones are multiplied', () => {
  const x = run();
  assert.deepEqual(
    x.after.badges.map((r) => r.target),
    [1000, 5000, 5, 10]
  );
});
test('Point badge progress scales, other metrics and earned status do not', () => {
  const x = run();
  assert.deepEqual(
    x.after.progress.map((r) => r.value),
    [250, 250, 3, 1000]
  );
  assert.deepEqual(
    x.after.progress.map((r) => r.earned),
    x.before.progress.map((r) => r.earned)
  );
  assert.deepEqual(
    x.after.progress.map((r) => r.percent),
    x.before.progress.map((r) => r.percent)
  );
});
test('operator adjustment positive/negative and NULL semantics are conserved', () => {
  const x = run();
  assert.deepEqual(
    x.after.operatorActions.map((r) => r.amount),
    [-70, null]
  );
});
test('SECURITY DEFINER is not dropped or changed to invoker', () => {
  const x = run();
  assert.equal(x.after.rpc.securityDefiner, true);
  assert.equal(x.after.rpc.owner, 'postgres');
  assert.deepEqual(x.after.rpc.executeAcl, ['postgres', 'service_role']);
  assert.equal(x.after.rpc.searchPath, '');
});
test('simulated 5 to 50 preserves event key policy and source identity', () => {
  const x = run();
  assert.equal(x.before.rpc.points, 5);
  assert.equal(x.after.rpc.points, 50);
  assert.equal(x.after.rpc.sourceSha256, SCOUT_POINT_10X_RPC_LEGACY_SHA256);
  assert.equal(x.after.rpc.eventKeyPolicy, 'user-level-unique');
});
test('private durable marker is committed only in the synthetic copy', () => {
  const x = run();
  assert.equal(x.before.marker.cutoverId, null);
  assert.equal(
    x.after.marker.cutoverId,
    'synthetic:reader-reward-point10x:unique-once'
  );
  assert.equal(x.after.marker.unit, '10pt_per_yen');
  assert.equal(x.mayCreateMarker, false);
});
test('already converted old snapshot must not convert twice', () => {
  const x = run(),
    twice = simulateScout10xAtomicCutover({
      snapshot: x.after,
      controls: controls()
    });
  assert.equal(twice.status, 'already_converted_or_marker_conflict_hold');
  assert.deepEqual(twice.after, twice.before);
  immutableProof(twice);
});
test('pre-existing marker blocks conversion, even if old unit claims unchanged', () => {
  const s = fixture();
  s.marker.cutoverId = 'previous-cutover';
  const x = run({ snapshot: s });
  assert.equal(x.status, 'already_converted_or_marker_conflict_hold');
  assert.deepEqual(x.after, s);
});
test('new reward value without old unit marker is held', () => {
  const s = fixture();
  s.rpc.points = 50;
  assert.equal(
    run({ snapshot: s }).status,
    'already_converted_or_marker_conflict_hold'
  );
});
test('lack of OWNER scope review blocks synthetic cutover', () => {
  const c = controls();
  c.ownerScopeReviewed = false;
  assert.equal(run({ controls: c }).status, 'synthetic_precondition_hold');
});
test('lack of restored backup blocks cutover', () => {
  const c = controls();
  c.independentBackupRestored = false;
  assert.equal(run({ controls: c }).blockedBy, 'independentBackupRestored');
});
test('old writer not paused blocks cutover', () => {
  const c = controls();
  c.allWritersPaused = false;
  assert.equal(run({ controls: c }).blockedBy, 'allWritersPaused');
});
test('database exclusion fence is mandatory', () => {
  const c = controls();
  c.exclusiveDatabaseFence = false;
  assert.equal(run({ controls: c }).blockedBy, 'exclusiveDatabaseFence');
});
test('inflight award or retry blocks cutover', () => {
  const c = controls();
  c.noInflightAwards = false;
  assert.equal(run({ controls: c }).blockedBy, 'noInflightAwards');
});
test('full row reconciliation is mandatory before simulated commit', () => {
  const c = controls();
  c.fullRowReconciliation = false;
  assert.equal(run({ controls: c }).blockedBy, 'fullRowReconciliation');
});
test('any missing writer class blocks cutover', () => {
  for (const w of SCOUT_POINT_10X_WRITER_CLASSES) {
    const c = controls();
    c.pausedWriterClasses = c.pausedWriterClasses.filter((x) => x !== w);
    assert.equal(
      run({ controls: c }).blockedBy,
      'not_all_writer_classes_paused'
    );
  }
});
test('unclassified direct SQL writer blocks cutover', () => {
  const c = controls();
  c.unknownWriters = ['public.rpc_unreviewed'];
  assert.equal(
    run({ controls: c }).blockedBy,
    'unclassified_writers_not_drained'
  );
});
test('production Staging project ref fails a synthetic-only fixture gate', () => {
  const c = controls();
  c.projectRef = 'fiepaguycecrredwrcwx';
  assert.equal(
    run({ controls: c }).blockedBy,
    'not_an_isolated_synthetic_environment'
  );
});
test('missing or incorrectly typed synthetic snapshot is rejected', () => {
  for (const snapshot of [undefined, null, {}, [], { source: 'production' }]) {
    assert.throws(() =>
      simulateScout10xAtomicCutover({ snapshot, controls: controls() })
    );
  }
});
test('duplicate event keys cannot pass', () => {
  const s = fixture();
  s.ledger.push({ ...s.ledger[0], id: 'other' });
  assert.throws(() => run({ snapshot: s }), RangeError);
});
test('duplicate badge IDs and progress keys cannot pass', () => {
  const b = fixture();
  b.badges.push({ ...b.badges[0] });
  assert.throws(() => run({ snapshot: b }), RangeError);
  const p = fixture();
  p.progress.push({ ...p.progress[0] });
  assert.throws(() => run({ snapshot: p }), RangeError);
});
test('existing signed ledger numeric limit is a hard stop', () => {
  const s = fixture();
  s.ledger[0].points = 100001;
  assert.throws(() => run({ snapshot: s }), TypeError);
});
test('badge integer overflow and Point progress overflow fail closed', () => {
  const b = fixture();
  b.badges[2].reward = 214748365;
  assert.throws(() => run({ snapshot: b }), TypeError);
  const p = fixture();
  p.progress[0].value = Number.MAX_SAFE_INTEGER;
  assert.throws(() => run({ snapshot: p }), TypeError);
});
test('operator check constraint refuses values too large for x10', () => {
  const s = fixture();
  s.operatorActions[0].amount = 10001;
  assert.throws(() => run({ snapshot: s }), RangeError);
});
test('unrecognized status and improper privilege mode refuse simulation', () => {
  const s = fixture();
  s.ledger[0].status = 'redeemed';
  assert.throws(() => run({ snapshot: s }), TypeError);
  const t = fixture();
  t.rpc.securityDefiner = false;
  assert.throws(() => run({ snapshot: t }), TypeError);
});
test('unreviewed search_path or public execute ACL refuse simulation', () => {
  const s = fixture();
  s.rpc.searchPath = 'public';
  assert.throws(() => run({ snapshot: s }), TypeError);
  const t = fixture();
  t.rpc.executeAcl = ['public'];
  assert.throws(() => run({ snapshot: t }), TypeError);
});
test('synthetic baseline and caller input are not mutated by model', () => {
  const s = fixture(),
    c = controls(),
    original = deepCopy(s);
  run({ snapshot: s, controls: c });
  assert.deepEqual(s, original);
});
test('fault injection rejects unknown execution steps', () => {
  assert.throws(() => run({ failAfterStage: 'UNKNOWN' }), RangeError);
});
for (const stage of SCOUT_10X_ATOMIC_STAGES) {
  test(
    'fault after ' + stage + ' returns original state (marker/RPC included)',
    () => {
      const x = run({ failAfterStage: stage });
      const postCommit =
        SCOUT_10X_ATOMIC_STAGES.indexOf(stage) >=
        SCOUT_10X_ATOMIC_STAGES.indexOf('13_commit_all_changes_once');
      if (postCommit) {
        assert.equal(x.status, 'synthetic_post_commit_failure_recovery_hold');
        assert.equal(x.simulatedCommit, true);
        assert.equal(x.simulatedRollback, false);
        assert.equal(x.noAutomaticStaleBackupRestore, true);
        assert.equal(x.after.rpc.points, 50);
        assert.ok(x.after.marker.cutoverId);
      } else {
        assert.equal(x.status, 'synthetic_atomic_rollback');
        assert.equal(x.simulatedRollback, true);
        assert.equal(x.markerAndRpcRestored, true);
        assert.deepEqual(x.after, x.before);
        assert.equal(x.after.marker.cutoverId, null);
        assert.equal(x.after.rpc.points, 5);
      }
      assert.equal(x.committedToAnyDatabase, false);
      assert.ok(x.executedStages.includes(stage));
      immutableProof(x);
    }
  );
}
test('post-commit restore of stale snapshot cannot erase legitimate new events', () => {
  const x = quoteScout10xPostCommitRecovery({
    committed: true,
    newLegitimateAwards: 2,
    backupUnit: '1pt_per_yen',
    postCommitUnit: '10pt_per_yen',
    markerPresent: true,
    independentEventJournalVerified: true,
    proposal: 'restore_old_snapshot'
  });
  assert.equal(x.status, 'post_commit_recovery_hold');
  assert.ok(x.blockers.includes('stale_restore_would_erase_new_awards'));
  assert.equal(x.restoreOldSnapshotAllowed, false);
  immutableProof(x);
});
test('post-commit forward repair requires separate OWNER approval', () => {
  const x = quoteScout10xPostCommitRecovery({
    committed: true,
    newLegitimateAwards: 2,
    backupUnit: '1pt_per_yen',
    postCommitUnit: '10pt_per_yen',
    markerPresent: true,
    independentEventJournalVerified: true,
    proposal: 'forward_repair_with_journal'
  });
  assert.equal(x.status, 'recovery_review_candidate_only');
  assert.equal(x.forwardRepairRequiresSeparateOwnerApproval, true);
  assert.equal(x.postCommitRecoveryExecuted, false);
  immutableProof(x);
});
test('post-commit recovery with no independent journal remains held', () => {
  const x = quoteScout10xPostCommitRecovery({
    committed: true,
    newLegitimateAwards: 1,
    backupUnit: '1pt_per_yen',
    postCommitUnit: '10pt_per_yen',
    markerPresent: true
  });
  assert.ok(x.blockers.includes('independent_new_event_journal_missing'));
});
test('negative or unknown legitimate award count is not accepted as safe', () => {
  for (const newLegitimateAwards of [-1, 0.1, undefined]) {
    const x = quoteScout10xPostCommitRecovery({
      committed: true,
      newLegitimateAwards,
      backupUnit: '1pt_per_yen',
      postCommitUnit: '10pt_per_yen',
      markerPresent: true
    });
    assert.equal(x.status, 'post_commit_recovery_hold');
  }
});
test('model gate and immutable stage lists never return execution authority', () => {
  assert.ok(Object.isFrozen(SCOUT_10X_ATOMIC_STAGES));
  assert.ok(Object.isFrozen(SCOUT_10X_REQUIRED_GATES));
  assert.ok(Object.isFrozen(SCOUT_10X_PRIVATE_MARKER_REQUIREMENTS));
  immutableProof(quoteScout10xStagingExecutionBoundary(gateValues()));
  immutableProof(run());
});
