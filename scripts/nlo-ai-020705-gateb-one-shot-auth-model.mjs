// Gate B synthetic OS-identity test: pure OFFLINE safety model only.
// All state transitions represent test assertions, NOT Windows mutations.
const EXPECTED_HOST = 'DESKTOP-8Q4GFC8';
const EXPECTED_ACCOUNT = 'NOVELIGHT-GateB';
const EXPECTED_BRANCH = 'work/ai-020705-gateb-one-shot-auth-preflight-20261107';
const PRODUCTION = 'fiepaguycecrredwrcwx';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const FAILURE_STAGES = Object.freeze([
  'preflight',
  'armWatchdog',
  'resetPassword',
  'enableUser',
  'startSyntheticChild',
  'disableUser',
  'crossUserDeny',
  'cleanupNewProfile',
  'zeroResidue'
]);

function result(status, observed = []) {
  return Object.freeze({
    status,
    simulationOnly: true,
    observed: Object.freeze([...observed]),
    executionAuthorized: false,
    userChanged: false,
    realUserEnabled: false,
    realPasswordReset: false,
    actualWatchdogArmed: false,
    syntheticUserLoggedOn: false,
    realDpapiTestRun: false,
    realPatAccepted: false,
    cloudMutations: 0,
    stagingWriteAuthorized: false,
    productionAccessAuthorized: false,
    aiSpendAuthorized: false,
    gateBGo: false
  });
}

function exactKeys(value, names) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const keys = Object.keys(value);
  return (
    keys.length === names.length && keys.every((key) => names.includes(key))
  );
}

export function simulateGateBOneShotAuth(input = {}) {
  const names = [
    'mode',
    'host',
    'account',
    'branch',
    'stagingRef',
    'watchdogIndependentlyAttested',
    'initiallyDisabled',
    'profileInitiallyAbsent',
    'approvalAttempts',
    'failAtStage'
  ];
  if (!exactKeys(input, names) || input.mode !== 'OFFLINE_SIMULATION_ONLY') {
    return result('BLOCK_EXACT_OFFLINE_OPT_IN_REQUIRED');
  }
  if (
    input.host !== EXPECTED_HOST ||
    input.account !== EXPECTED_ACCOUNT ||
    input.branch !== EXPECTED_BRANCH ||
    input.stagingRef !== STAGING ||
    input.stagingRef === PRODUCTION
  ) {
    return result('BLOCK_SCOPE_MISMATCH');
  }
  if (
    input.initiallyDisabled !== true ||
    input.profileInitiallyAbsent !== true ||
    input.approvalAttempts !== 1 ||
    ![null, ...FAILURE_STAGES].includes(input.failAtStage)
  ) {
    return result('BLOCK_PRECONDITIONS_OR_REPLAY');
  }
  if (input.watchdogIndependentlyAttested !== true) {
    return result('BLOCK_CRASH_RECOVERY_WITNESS_MISSING');
  }
  const steps = [];
  // Simulation: changes here do NOT touch an OS user or DPAPI.
  let mockEnabled = false;
  for (const step of FAILURE_STAGES) {
    steps.push(step);
    if (step === 'enableUser') mockEnabled = true;
    if (step === 'disableUser') mockEnabled = false;
    if (step === input.failAtStage) {
      // Independent crash recovery is represented only by a mocked contract.
      // The real witness must be assessed outside this module.
      steps.push(
        mockEnabled ? 'mockWatchdogDisablesUser' : 'mockAlreadyDisabled'
      );
      return result('OFFLINE_INJECTED_FAILURE_RECOVERED_NO_GO', steps);
    }
  }
  return result('OFFLINE_COMPLETE_CONTRACT_SIMULATED_NO_GO', steps);
}

// Even perfect simulated evidence cannot open a runner or Windows account.
// There is no live execution adapter in this module.
export function enableGateBUser() {
  throw new Error('GATEB_REAL_OS_IDENTITY_CHANGE_NOT_IMPLEMENTED');
}
