import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  inspectScoutPoint10xLockTopology,
  simulateScoutPoint10xClaimRace
} from '../scripts/scout-point10x-claim-race-model.mjs';

const oldWorkflow = readFileSync(
  new URL(
    '../.github/workflows/staging-reader-point-tenfold-proof.yml',
    import.meta.url
  ),
  'utf8'
);
const inertBlueprint = readFileSync(
  new URL(
    '../docs/plans/READER-REWARD-POINT10X-OWNER-LEDGER-INERT-WORKFLOW-20261105.yml',
    import.meta.url
  ),
  'utf8'
);
const inspect = (overrides = {}) =>
  inspectScoutPoint10xLockTopology({
    existingWorkflow: oldWorkflow,
    inertBlueprint,
    ...overrides
  });
const denied = (x) => {
  assert.equal(x.authoritative, false);
  for (const prop of [
    'mayReadStagingSecrets',
    'mayWriteStaging',
    'mayExecuteSql',
    'mayPostClaim',
    'mayPostConsumed',
    'mayMergeMain',
    'mayDeploy'
  ])
    assert.equal(x[prop], false, prop);
  assert.equal(Object.isFrozen(x), true);
};

test('current Draft old admit and stage concurrency groups differ', () => {
  const x = inspect();
  assert.equal(x.status, 'cross_workflow_serialization_unproven');
  assert.ok(x.blockers.includes('old_admit_and_stage_mutex_differ'));
  denied(x);
});
test('inert proposal does not use legacy stage mutex', () => {
  const x = inspect();
  assert.ok(x.blockers.includes('inert_mutex_differs_from_staging_mutex'));
  assert.equal(x.blueprintActivated, false);
  denied(x);
});
test('inert proposal does not use legacy admission mutex', () => {
  const x = inspect();
  assert.ok(x.blockers.includes('inert_mutex_differs_from_admission_mutex'));
  denied(x);
});
test('a shared future string does not make Issue comments atomic CAS', () => {
  const x = inspect({
    inertBlueprint: inertBlueprint.replace(
      'novelight-issue294-staging-atomic-review-inert',
      'supabase-staging-migration-sync'
    )
  });
  assert.ok(x.blockers.includes('issue_comments_are_not_atomic_cas'));
  assert.ok(
    x.blockers.includes('github_actions_concurrency_is_not_durable_fifo')
  );
  denied(x);
});
test('missing legacy workflow fails closed', () => {
  const x = inspect({ existingWorkflow: '' });
  assert.ok(x.blockers.includes('workflow_mutex_parse_unverifiable'));
  denied(x);
});
test('missing inert plan fails closed', () => {
  const x = inspect({ inertBlueprint: '' });
  assert.ok(x.blockers.includes('workflow_mutex_parse_unverifiable'));
  denied(x);
});
test('duplicated admission definition cannot masquerade as one mutex', () => {
  const x = inspect({
    existingWorkflow:
      oldWorkflow + '\n  admit:\n    concurrency:\n      group: fake\n'
  });
  assert.ok(x.blockers.includes('workflow_mutex_parse_unverifiable'));
  denied(x);
});
test('invalid mutex character cannot pass structural parse', () => {
  const x = inspect({
    inertBlueprint: inertBlueprint.replace(
      'novelight-issue294-staging-atomic-review-inert',
      '${{ secrets.DANGEROUS_DYNAMIC_GROUP }}'
    )
  });
  assert.ok(x.blockers.includes('workflow_mutex_parse_unverifiable'));
  denied(x);
});
test('all existing workflow references remain non-authoritative input', () => {
  const x = inspect();
  assert.ok(x.mutexes.oldAdmit);
  assert.ok(x.mutexes.oldStage);
  assert.ok(x.mutexes.inertProposed);
  assert.equal(x.approvalConsumed, false);
  denied(x);
});
test('unserialized double-read creates a real logical counterexample', () => {
  const x = simulateScoutPoint10xClaimRace();
  assert.equal(x.schedulesChecked, 20);
  assert.ok(x.doubleClaimScheduleCount > 0);
  assert.equal(x.possibleDoubleClaim, true);
  assert.deepEqual(x.firstCounterexample.slice(0, 2), ['A.scan', 'B.scan']);
  denied(x);
});
test('ideal serialization removes double claim only inside the toy model', () => {
  const x = simulateScoutPoint10xClaimRace({ idealSerialization: true });
  assert.equal(x.schedulesChecked, 2);
  assert.equal(x.doubleClaimScheduleCount, 0);
  assert.equal(x.possibleDoubleClaim, false);
  assert.equal(x.guaranteesRealLock, false);
  assert.equal(x.guaranteesClaimPersistence, false);
  denied(x);
});
test('a boolean model claim does not create a real durable queue', () => {
  const x = simulateScoutPoint10xClaimRace({ idealSerialization: true });
  assert.equal(x.guaranteesDurableQueue, false);
  assert.equal(x.proofOfOwnerAuthentication, false);
  denied(x);
});
test('invalid serialization assumption fails closed', () => {
  const x = simulateScoutPoint10xClaimRace({ idealSerialization: 'yes' });
  assert.equal(x.status, 'invalid_race_model_input');
  assert.ok(x.blockers.includes('invalid_serialization_assumption'));
  denied(x);
});
test('model results cannot directly publish CLAIMED or CONSUMED', () => {
  for (const idealSerialization of [false, true]) {
    const x = simulateScoutPoint10xClaimRace({ idealSerialization });
    assert.equal(x.mayPostClaim, false);
    assert.equal(x.mayPostConsumed, false);
    denied(x);
  }
});
