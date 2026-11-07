// NOVELIGHT Gate B: pure offline state model. No Windows, DPAPI, cloud, or task access.
const PIN = Object.freeze({
  host: 'DESKTOP-8Q4GFC8',
  user: 'NOVELIGHT-GateB',
  task: 'NOVELIGHT-GateB-Independent-Recovery',
  workerSha256:
    '78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c'
});
export const STAGES = Object.freeze([
  'readOnlyAdminPreflight',
  'pinOriginalStateAndHeartbeat',
  'rejectExistingOneShotLedger',
  'consumeDurableOneShotLedger',
  'stageNonexistentParentPid',
  'atomicReplaceGuardWithSynthetic',
  'waitForIndependentParentGoneReason',
  'proveAccountNeverEnabled',
  'atomicallyRestoreOriginalGuardState',
  'observeNewIndependentGuardOnlyHeartbeat',
  'censusChildProcessAndProfile',
  'censusTemporaryFilesAndVault',
  'verifyNloDefinitionsUnchanged',
  'retainOnlyExplicitOneShotLedger'
]);
const REJECTION = Object.freeze({
  authorized: false,
  realOsMutation: false,
  accountEnabled: false,
  passwordReset: false,
  parentKilled: false,
  childKilled: false,
  dpapiTested: false,
  stateWritten: false,
  taskChanged: false,
  cloudMutations: 0,
  secretsUsed: false,
  paidModelCalls: 0,
  gateBComplete: false,
  gatesAtoEPassed: 0
});
function result(status, stages = []) {
  return Object.freeze({
    ...REJECTION,
    offlineOnly: true,
    status,
    stages: Object.freeze([...stages])
  });
}
function exact(x, keys) {
  return (
    x !== null &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    Object.getPrototypeOf(x) === Object.prototype &&
    Object.keys(x).length === keys.length &&
    Object.keys(x).every((k) => keys.includes(k))
  );
}
const BASE_KEYS = Object.freeze([
  'mode',
  'host',
  'user',
  'task',
  'workerSha256',
  'accountDisabled',
  'nonAdmin',
  'profileAbsent',
  'vaultEmpty',
  'taskSystem',
  'taskActionPinned',
  'taskLastExitZero',
  'taskReady',
  'taskScheduleMinutesRemaining',
  'aclPinned',
  'sidPinned',
  'guardOnly',
  'heartbeatFreshSeconds',
  'heartbeatSequence',
  'heartbeatReasonGuardOnly',
  'heartbeatOutcomeAlreadyDisabled',
  'knownFilesOnly',
  'noPriorLedger',
  'nloUnchanged'
]);
function fixed(x) {
  return (
    x.host === PIN.host &&
    x.user === PIN.user &&
    x.task === PIN.task &&
    x.workerSha256 === PIN.workerSha256
  );
}
export function assessDisabledGuardBaseline(x = {}) {
  if (!exact(x, BASE_KEYS) || x.mode !== 'OFFLINE_ONLY')
    return result('BLOCK_OFFLINE_INPUT');
  if (!fixed(x)) return result('BLOCK_FIXED_TARGET');
  if (
    [
      'accountDisabled',
      'nonAdmin',
      'profileAbsent',
      'vaultEmpty',
      'taskSystem',
      'taskActionPinned',
      'taskLastExitZero',
      'taskReady',
      'aclPinned',
      'sidPinned',
      'guardOnly',
      'heartbeatReasonGuardOnly',
      'heartbeatOutcomeAlreadyDisabled',
      'knownFilesOnly',
      'noPriorLedger',
      'nloUnchanged'
    ].some((k) => x[k] !== true)
  )
    return result('BLOCK_TRUST_OR_ONE_SHOT_PRECONDITION');
  if (
    !Number.isInteger(x.heartbeatSequence) ||
    x.heartbeatSequence < 2 ||
    !Number.isFinite(x.heartbeatFreshSeconds) ||
    x.heartbeatFreshSeconds < 0 ||
    x.heartbeatFreshSeconds > 150 ||
    !Number.isFinite(x.taskScheduleMinutesRemaining) ||
    x.taskScheduleMinutesRemaining <= 30
  ) {
    return result('BLOCK_STALE_HEARTBEAT_OR_EXPIRING_SCHEDULE');
  }
  return result('OFFLINE_GUARD_BASELINE_MATCH_NO_GO');
}
const TRIAL_KEYS = Object.freeze([
  'mode',
  'host',
  'user',
  'task',
  'workerSha256',
  'accountDisabled',
  'approvalAttempts',
  'oneShotLedgerAvailable',
  'syntheticPidAbsent',
  'originalGuardHashPinned',
  'parentReasonObserved',
  'parentOutcomeAlreadyDisabled',
  'guardAtomicRestoreVerified',
  'guardHeartbeatAfterParentReason',
  'userStillDisabled',
  'childProcessesAbsent',
  'profileAbsent',
  'vaultEmpty',
  'temporaryFilesAbsent',
  'ledgerRetained',
  'nloUnchanged',
  'failAt'
]);
export function simulateOneShotParentGone(x = {}) {
  if (!exact(x, TRIAL_KEYS) || x.mode !== 'OFFLINE_ONLY')
    return result('BLOCK_OFFLINE_INPUT');
  if (!fixed(x)) return result('BLOCK_FIXED_TARGET');
  if (
    x.approvalAttempts !== 1 ||
    x.oneShotLedgerAvailable !== true ||
    x.syntheticPidAbsent !== true ||
    x.originalGuardHashPinned !== true ||
    x.accountDisabled !== true ||
    ![null, ...STAGES].includes(x.failAt)
  ) {
    return result('BLOCK_REPLAY_OR_PARENT_PID_OR_GUARD');
  }
  const visited = [];
  for (const stage of STAGES) {
    visited.push(stage);
    if (x.failAt === stage) {
      return result(
        'OFFLINE_INJECTED_FAILURE_CONSUMED_MANUAL_CENSUS_NO_GO',
        visited
      );
    }
    if (
      stage === 'waitForIndependentParentGoneReason' &&
      (x.parentReasonObserved !== true ||
        x.parentOutcomeAlreadyDisabled !== true)
    ) {
      return result('BLOCK_PARENT_GONE_REASON_NOT_PROVEN_NO_GO', visited);
    }
    if (
      stage === 'atomicallyRestoreOriginalGuardState' &&
      x.guardAtomicRestoreVerified !== true
    ) {
      return result('BLOCK_GUARD_RESTORE_NOT_PROVEN_NO_GO', visited);
    }
    if (
      stage === 'observeNewIndependentGuardOnlyHeartbeat' &&
      x.guardHeartbeatAfterParentReason !== true
    ) {
      return result('BLOCK_FRESH_GUARD_WITNESS_MISSING_NO_GO', visited);
    }
    if (
      stage === 'censusChildProcessAndProfile' &&
      (x.userStillDisabled !== true ||
        x.childProcessesAbsent !== true ||
        x.profileAbsent !== true)
    ) {
      return result('BLOCK_ACCOUNT_PROCESS_PROFILE_RESIDUE_NO_GO', visited);
    }
    if (
      stage === 'censusTemporaryFilesAndVault' &&
      (x.vaultEmpty !== true ||
        x.temporaryFilesAbsent !== true ||
        x.ledgerRetained !== true)
    ) {
      return result('BLOCK_TEMP_RESIDUE_OR_LEDGER_UNVERIFIED_NO_GO', visited);
    }
    if (stage === 'verifyNloDefinitionsUnchanged' && x.nloUnchanged !== true) {
      return result('BLOCK_NLO_CHANGE_NO_GO', visited);
    }
  }
  return result(
    'OFFLINE_PARENT_GONE_BRANCH_AND_RESTORE_SIMULATED_NO_GO',
    visited
  );
}
const CENSUS_KEYS = Object.freeze([
  'mode',
  'host',
  'user',
  'task',
  'workerSha256',
  'accountDisabled',
  'guardRestoredSameHash',
  'guardOnly',
  'workerHashPinned',
  'taskDefinitionUnchanged',
  'heartbeatSequenceIncreased',
  'newGuardHeartbeatFresh',
  'reasonCodeGuardOnly',
  'disableOutcomeAlreadyDisabled',
  'profileAbsent',
  'childProcessesAbsent',
  'vaultEmpty',
  'temporaryFilesAbsent',
  'oneShotLedgerRetained',
  'nloUnchanged'
]);
export function assessFinalResidue(x = {}) {
  if (!exact(x, CENSUS_KEYS) || x.mode !== 'OFFLINE_ONLY')
    return result('BLOCK_OFFLINE_INPUT');
  if (!fixed(x)) return result('BLOCK_FIXED_TARGET');
  if (CENSUS_KEYS.slice(5).some((k) => x[k] !== true)) {
    return result('BLOCK_CENSUS_NOT_ZERO_NO_GO');
  }
  return result('OFFLINE_FINAL_CENSUS_CONTRACT_MATCH_NO_GO');
}
export function startLiveParentGoneTest() {
  throw new Error(
    'GATEB_LIVE_PARENTGONE_TEST_NOT_AUTHORIZED_OR_IMPLEMENTED_IN_JS'
  );
}
