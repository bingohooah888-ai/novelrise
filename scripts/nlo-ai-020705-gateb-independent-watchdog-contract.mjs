// Gate B independent Windows recovery watchdog: PURE OFFLINE contract.
// It is NOT an OS task/credential adapter and cannot authorize real execution.
const HOST = 'DESKTOP-8Q4GFC8';
const ACCOUNT = 'NOVELIGHT-GateB';
const TASK = 'NOVELIGHT-GateB-Independent-Recovery';
const PHASES = new Set(['GUARD_ONLY', 'GUARDED_TEST']);
const ONE_SHOT_STEPS = Object.freeze([
  'validateAccountDisabled',
  'validateParentAndWorkerHash',
  'createProtectedDirectory',
  'copyHashPinnedWorker',
  'writeNoSecretManifest',
  'registerOneSystemTask',
  'startTask',
  'verifyIndependentHeartbeat'
]);

function safe(status, intent, stages = []) {
  return Object.freeze({
    status,
    intent,
    simulated: true,
    stages: Object.freeze([...stages]),
    ownerApprovalSpent: false,
    accountEnabled: false,
    accountPasswordChanged: false,
    systemTaskCreated: false,
    realRecoveryDemonstrated: false,
    actualWindowsMutations: 0,
    realPatAccepted: false,
    cloudMutations: 0,
    stagingAuthorized: false,
    productionAuthorized: false,
    gateBGo: false
  });
}
function keysExactly(x, props) {
  return Boolean(
    x &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    Object.getPrototypeOf(x) === Object.prototype &&
    Object.keys(x).length === props.length &&
    Object.keys(x).every((k) => props.includes(k))
  );
}

export function decideGateBWatchdogRecovery(input = {}) {
  const props = [
    'mode',
    'host',
    'account',
    'taskName',
    'systemPrincipal',
    'protectedAcl',
    'sidMatches',
    'phase',
    'parentAlive',
    'deadlineReached',
    'enabled'
  ];
  if (!keysExactly(input, props) || input.mode !== 'OFFLINE_SIMULATE') {
    return safe('BLOCK_NOT_OFFLINE_CONTRACT', 'NONE');
  }
  if (
    input.host !== HOST ||
    input.account !== ACCOUNT ||
    input.taskName !== TASK ||
    !PHASES.has(input.phase) ||
    typeof input.parentAlive !== 'boolean' ||
    typeof input.deadlineReached !== 'boolean' ||
    typeof input.enabled !== 'boolean'
  ) {
    return safe('BLOCK_TARGET_OR_STATE_MISMATCH', 'NONE');
  }
  if (
    input.systemPrincipal !== true ||
    input.protectedAcl !== true ||
    input.sidMatches !== true
  ) {
    return safe('BLOCK_UNTRUSTED_SYSTEM_BOUNDARY', 'NONE');
  }
  if (!input.enabled) {
    return safe('OFFLINE_ALREADY_DISABLED_NO_GO', 'READONLY_CENSUS');
  }
  if (
    input.phase === 'GUARD_ONLY' ||
    !input.parentAlive ||
    input.deadlineReached
  ) {
    return safe(
      'OFFLINE_RECOVERY_DISABLE_REQUIRED_NO_GO',
      'DISABLE_ONLY_PINNED_SID'
    );
  }
  return safe('OFFLINE_GUARDED_PARENT_ALIVE_NO_GO', 'MONITOR_NEXT_TICK');
}

export function simulateGateBWatchdogArm(input = {}) {
  const keys = [
    'mode',
    'host',
    'account',
    'taskName',
    'initiallyDisabled',
    'taskInitiallyAbsent',
    'directoryInitiallyAbsent',
    'approvedAttemptCount',
    'failStage'
  ];
  if (!keysExactly(input, keys) || input.mode !== 'OFFLINE_SIMULATE') {
    return safe('BLOCK_OFFLINE_INPUT_REQUIRED', 'NONE');
  }
  if (
    input.host !== HOST ||
    input.account !== ACCOUNT ||
    input.taskName !== TASK
  )
    return safe('BLOCK_SCOPE_DRIFT', 'NONE');
  if (
    input.initiallyDisabled !== true ||
    input.taskInitiallyAbsent !== true ||
    input.directoryInitiallyAbsent !== true ||
    input.approvedAttemptCount !== 1 ||
    (input.failStage !== null && !ONE_SHOT_STEPS.includes(input.failStage))
  ) {
    return safe('BLOCK_PRECONDITIONS_OR_REPLAY', 'NONE');
  }
  const stages = [];
  for (const step of ONE_SHOT_STEPS) {
    stages.push(step);
    if (step === input.failStage) {
      return safe(
        'OFFLINE_FAILURE_REQUIRES_MANUAL_RECONCILIATION_NO_GO',
        'STOP_NO_AUTO_RETRY',
        stages
      );
    }
  }
  return safe(
    'OFFLINE_WATCHDOG_ARM_SEQUENCE_MODELED_NO_GO',
    'GUARD_ONLY_MODEL_NO_LIVE_PROOF',
    stages
  );
}

export function simulateWatchdogCleanup(input = {}) {
  const keys = [
    'mode',
    'host',
    'account',
    'taskName',
    'accountDisabled',
    'guardOnlyPhase',
    'taskActionPinned',
    'workerHashPinned',
    'unknownFilesPresent',
    'approvalAttempts'
  ];
  if (!keysExactly(input, keys) || input.mode !== 'OFFLINE_SIMULATE') {
    return safe('BLOCK_OFFLINE_CLEANUP_INPUT', 'NONE');
  }
  if (
    input.host !== HOST ||
    input.account !== ACCOUNT ||
    input.taskName !== TASK
  )
    return safe('BLOCK_SCOPE_DRIFT', 'NONE');
  if (
    input.accountDisabled !== true ||
    input.guardOnlyPhase !== true ||
    input.taskActionPinned !== true ||
    input.workerHashPinned !== true ||
    input.unknownFilesPresent !== false ||
    input.approvalAttempts !== 1
  ) {
    return safe('BLOCK_UNSAFE_CLEANUP', 'KEEP_GUARD');
  }
  return safe(
    'OFFLINE_OWNED_WATCHDOG_CLEANUP_MODELED_NO_GO',
    'UNREGISTER_ONLY_PINNED_TASK_THEN_DELETE_ONLY_OWNED_FILES'
  );
}

export function runLiveGateBWatchdog() {
  throw new Error(
    'LIVE_GATEB_WATCHDOG_ACTION_NOT_AUTHORIZED_BY_OFFLINE_CONTRACT'
  );
}
