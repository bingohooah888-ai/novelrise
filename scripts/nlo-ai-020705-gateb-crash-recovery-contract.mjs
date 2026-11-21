// NOVELIGHT AI Phase 2 / Gate B: crash recovery + synthetic DPAPI safety contract.
// Pure model only. No OS account, process, task, network, DPAPI, or secret operations.
const FIXED = Object.freeze({
  host: 'DESKTOP-8Q4GFC8',
  user: 'NOVELIGHT-GateB',
  task: 'NOVELIGHT-GateB-Independent-Recovery',
  phase: 'GUARD_ONLY',
  workerSha256:
    'dd418a7a50854c54a182fd3042b8dfadd5b8da77f9c99d106aab4bd706c3e66f'
});
export const CRASH_STAGES = Object.freeze([
  'independentGuardReadiness',
  'oneShotApprovalCheck',
  'generateEphemeralPassword',
  'guardedStateCommittedAtomically',
  'enableOnlyFixedSid',
  'launchPinnedSyntheticChildWithLoadedProfile',
  'verifyChildPidAndStartTime',
  'terminateOnlyFixedParentPidAndStartTime',
  'independentWatchdogDisablesFixedSid',
  'terminateOnlyPinnedSyntheticChild',
  'verifyNoLogonTokensOrOwnedProcessesRemain',
  'verifyCrossUserDpapiDenial',
  'verifyNewProfileAndDpapiArtifacts',
  'returnWatchdogToGuardOnly',
  'independentZeroResidueCensus'
]);
const NO_AUTHORIZATION = Object.freeze({
  liveExecutionAuthorized: false,
  userEnabled: false,
  passwordReset: false,
  processKilled: false,
  taskMutated: false,
  dpapiExecuted: false,
  liveRecoveryAttested: false,
  profileDeleted: false,
  realPatUsed: false,
  cloudMutations: 0,
  productionAccessGranted: false,
  gateBGo: false
});
function safe(status, steps = []) {
  return Object.freeze({
    status,
    ...NO_AUTHORIZATION,
    simulationOnly: true,
    steps: Object.freeze([...steps])
  });
}
function exactShape(x, keys) {
  if (
    !x ||
    typeof x !== 'object' ||
    Array.isArray(x) ||
    Object.getPrototypeOf(x) !== Object.prototype
  )
    return false;
  const own = Object.keys(x);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}
const PRE = Object.freeze([
  'mode',
  'host',
  'user',
  'task',
  'workerSha256',
  'accountDisabled',
  'nonAdmin',
  'profileAbsent',
  'vaultEmpty',
  'guardPhase',
  'systemPrincipal',
  'taskActionPinned',
  'workerFilePinned',
  'protectedAcl',
  'sidMatches',
  'repeatedHeartbeat',
  'heartbeatAgeSeconds',
  'taskLastExitCode',
  'repetitionWindowMinutesLeft',
  'independentKillProof',
  'nloTaskDefinitionsUnchanged'
]);
export function evaluateGuardedCrashReadiness(input = {}) {
  if (!exactShape(input, PRE) || input.mode !== 'OFFLINE_ONLY') {
    return safe('BLOCK_EXACT_OFFLINE_READINESS_INPUT');
  }
  if (
    input.host !== FIXED.host ||
    input.user !== FIXED.user ||
    input.task !== FIXED.task ||
    input.workerSha256 !== FIXED.workerSha256 ||
    input.guardPhase !== FIXED.phase
  ) {
    return safe('BLOCK_FIXED_IDENTITY_OR_GUARD_SCOPE');
  }
  if (
    input.accountDisabled !== true ||
    input.nonAdmin !== true ||
    input.profileAbsent !== true ||
    input.vaultEmpty !== true ||
    input.systemPrincipal !== true ||
    input.taskActionPinned !== true ||
    input.workerFilePinned !== true ||
    input.protectedAcl !== true ||
    input.sidMatches !== true ||
    input.repeatedHeartbeat !== true ||
    input.taskLastExitCode !== 0 ||
    input.nloTaskDefinitionsUnchanged !== true
  ) {
    return safe('BLOCK_INDEPENDENT_GUARD_PROOF_INCOMPLETE');
  }
  if (
    !Number.isFinite(input.heartbeatAgeSeconds) ||
    input.heartbeatAgeSeconds < 0 ||
    input.heartbeatAgeSeconds > 120 ||
    !Number.isFinite(input.repetitionWindowMinutesLeft) ||
    input.repetitionWindowMinutesLeft < 30
  ) {
    return safe('BLOCK_STALE_HEARTBEAT_OR_EXPIRING_TASK');
  }
  // GUARD_ONLY success does not attest disabling an enabled user.
  if (input.independentKillProof !== true) {
    return safe('OFFLINE_GUARD_READY_BUT_KILL_RECOVERY_NOT_PROVEN_NO_GO');
  }
  // Even an untrusted mock claim of kill proof can never authorize Apply.
  return safe('OFFLINE_MOCK_READINESS_ONLY_NO_GO');
}
const TRIAL_KEYS = Object.freeze([
  'mode',
  'host',
  'user',
  'task',
  'ownerApprovalAttempts',
  'accountInitiallyDisabled',
  'guardWitnessCurrent',
  'parentIdentityPinned',
  'childIdentityPinned',
  'watchdogScheduleValid',
  'failAt',
  'watchdogSimulatesRecovery',
  'childProcessLeftRunning',
  'profileRemains',
  'crossUserDpapiDenySimulated'
]);
export function simulateCrashRecoveryTrial(input = {}) {
  if (!exactShape(input, TRIAL_KEYS) || input.mode !== 'OFFLINE_ONLY') {
    return safe('BLOCK_EXACT_OFFLINE_TRIAL_INPUT');
  }
  if (
    input.host !== FIXED.host ||
    input.user !== FIXED.user ||
    input.task !== FIXED.task
  )
    return safe('BLOCK_FIXED_TARGET_MISMATCH');
  if (
    input.ownerApprovalAttempts !== 1 ||
    input.accountInitiallyDisabled !== true ||
    input.guardWitnessCurrent !== true ||
    input.parentIdentityPinned !== true ||
    input.childIdentityPinned !== true ||
    input.watchdogScheduleValid !== true ||
    ![null, ...CRASH_STAGES].includes(input.failAt) ||
    typeof input.watchdogSimulatesRecovery !== 'boolean' ||
    typeof input.childProcessLeftRunning !== 'boolean' ||
    typeof input.profileRemains !== 'boolean' ||
    typeof input.crossUserDpapiDenySimulated !== 'boolean'
  ) {
    return safe('BLOCK_MISSING_GUARD_OR_REPLAY');
  }
  const steps = [];
  for (const stage of CRASH_STAGES) {
    steps.push(stage);
    if (input.failAt === stage) {
      return safe(
        'OFFLINE_INJECTED_FAILURE_REQUIRES_MANUAL_CENSUS_NO_GO',
        steps
      );
    }
    if (
      stage === 'independentWatchdogDisablesFixedSid' &&
      !input.watchdogSimulatesRecovery
    ) {
      return safe('OFFLINE_SIMULATED_WATCHDOG_MISSED_RECOVERY_NO_GO', steps);
    }
    if (
      stage === 'verifyNoLogonTokensOrOwnedProcessesRemain' &&
      input.childProcessLeftRunning
    ) {
      return safe(
        'OFFLINE_ENABLED_ACCOUNT_MAY_BE_DISABLED_BUT_PROCESS_REMAINS_NO_GO',
        steps
      );
    }
    if (
      stage === 'verifyCrossUserDpapiDenial' &&
      !input.crossUserDpapiDenySimulated
    ) {
      return safe('OFFLINE_DPAPI_USER_BOUNDARY_NOT_PROVEN_NO_GO', steps);
    }
    if (stage === 'verifyNewProfileAndDpapiArtifacts' && input.profileRemains) {
      return safe('OFFLINE_PROFILE_RESIDUE_MANUAL_RECONCILIATION_NO_GO', steps);
    }
  }
  return safe('OFFLINE_CRASH_RECOVERY_SEQUENCE_SIMULATED_NO_GO', steps);
}
const CENSUS_KEYS = Object.freeze([
  'mode',
  'host',
  'user',
  'task',
  'accountDisabled',
  'fixedSidMatches',
  'guardOnly',
  'heartbeatFresh',
  'workerHashPinned',
  'taskEnabled',
  'taskRunningSuccessfully',
  'parentProcessAbsent',
  'childProcessesAbsent',
  'newUserProfileAbsent',
  'vaultEmpty',
  'temporaryFilesAbsent',
  'nloTaskDefinitionsUnchanged',
  'realCredentialsNotUsed'
]);
export function evaluateZeroResidueCensus(input = {}) {
  if (!exactShape(input, CENSUS_KEYS) || input.mode !== 'OFFLINE_ONLY') {
    return safe('BLOCK_EXACT_OFFLINE_CENSUS_INPUT');
  }
  if (
    input.host !== FIXED.host ||
    input.user !== FIXED.user ||
    input.task !== FIXED.task
  )
    return safe('BLOCK_FIXED_SCOPE_MISMATCH');
  if (CENSUS_KEYS.slice(4).some((k) => input[k] !== true)) {
    return safe('BLOCK_RESIDUAL_PROCESS_PROFILE_OR_GUARD_UNVERIFIED');
  }
  return safe('OFFLINE_ZERO_RESIDUE_CONTRACT_MATCH_NO_GO');
}
const REASON_KEYS = Object.freeze([
  'mode',
  'host',
  'user',
  'task',
  'watchdogReason',
  'heartbeatFresh',
  'sidMatches',
  'accountDisabled'
]);
export function evaluateParentDeathReasonEvidence(input = {}) {
  if (!exactShape(input, REASON_KEYS) || input.mode !== 'OFFLINE_ONLY') {
    return safe('BLOCK_EXACT_REASON_EVIDENCE_INPUT');
  }
  if (
    input.host !== FIXED.host ||
    input.user !== FIXED.user ||
    input.task !== FIXED.task
  ) {
    return safe('BLOCK_REASON_EVIDENCE_SCOPE');
  }
  // Existing installed Worker overwrites its reason with
  // WATCHDOG_DISABLED_CONFIRMED when the account is disabled.
  if (input.watchdogReason !== 'WATCHDOG_PARENT_GONE') {
    return safe('BLOCK_PARENT_DEATH_BRANCH_NOT_OBSERVABLE');
  }
  if (
    input.heartbeatFresh !== true ||
    input.sidMatches !== true ||
    input.accountDisabled !== true
  ) {
    return safe('BLOCK_PARENT_DEATH_REASON_UNVERIFIED');
  }
  // Even an explicit synthetic branch marker is not a live disable proof.
  return safe('OFFLINE_PARENT_GONE_MARKER_MATCH_NO_REAL_DISABLE_PROOF_NO_GO');
}

// Explicit denial: no real OS, PAT, Staging, Production or model entrypoints.
export function startRealGuardedCrashTest() {
  throw new Error('GATEB_REAL_CRASH_DPAPI_EXECUTION_NOT_IMPLEMENTED');
}
