// Gate B guarded DPAPI launch / independent recovery CONTRACT ONLY.
// No node:child_process, fs, network, PAT, DPAPI, credential, or Windows mutation.
// Callers must not treat a mock execution result as proof of a real Windows run.
export const TARGET = Object.freeze({
  host: 'DESKTOP-8Q4GFC8',
  account: 'NOVELIGHT-GateB',
  watchdogTask: 'NOVELIGHT-GateB-Independent-Recovery',
  guardPhase: 'GUARD_ONLY',
  activePhase: 'GUARDED_TEST',
  maxGuardSeconds: 300,
  maxAccountEnabledSeconds: 240,
  watcherIntervalSeconds: 60,
  maxApply: 1,
  allowedCredentialModes: ['real-credential-logon-with-loaded-user-profile']
});

export const STEPS = Object.freeze([
  'PIN_CODE_AND_OWNER_APPROVAL',
  'VERIFY_HOST_ACCOUNT_SID_ACL_AND_WATCHDOG',
  'VERIFY_FRESH_HEARTBEAT_AND_TRIGGER_EXPIRY',
  'VERIFY_REAL_LOGON_PROFILE_AND_NO_SECRETS_IN_LOGS',
  'VERIFY_NO_TARGET_PROCESS_PROFILE_VAULT_RESIDUE',
  'ATOMIC_CONSUME_NEW_ONE_SHOT_MARKER',
  'ATOMically_ARM_GUARDED_TEST_WITH_PARENT_PID_START_UTC',
  'VERIFY_INDEPENDENT_GUARDED_WATCHDOG_HEARTBEAT',
  'ENABLE_ONLY_TARGET_ACCOUNT',
  'LAUNCH_PROTECTED_TARGET_SID_PROCESS_WITH_LOADED_PROFILE',
  'VERIFY_TARGET_SID_TOKEN_AND_PROCESS_BIRTH',
  'TARGET_CURRENTUSER_DPAPI_SYNTHETIC_CREATE',
  'NEW_TARGET_SID_PROCESS_SAME_USER_DPAPI_VERIFY',
  'DISABLE_TARGET_AND_OBSERVE_DISABLED',
  'ADMIN_OTHER_SID_DPAPI_CRYPTOGRAPHIC_REJECTION',
  'VERIFY_NO_CHILD_PROCESS_OR_LOGON_SESSION',
  'ATOMically_RESTORE_GUARD_ONLY',
  'VERIFY_NEW_INDEPENDENT_GUARD_HEARTBEAT',
  'RETAIN_AUDIT_LEDGER_AND_REPORT_RESIDUE'
]);

const PRECONDITIONS = Object.freeze([
  'hostPinned',
  'targetSidPinned',
  'targetDisabled',
  'targetNonAdmin',
  'guardOnly',
  'watchdogSystem',
  'watchdogFresh',
  'watchdogScheduleValid',
  'workerHashPinned',
  'codeHeadPinned',
  'scriptHashPinned',
  'ownerApprovalFresh',
  'targetProfileEmpty',
  'targetProcessZero',
  'vaultEmpty',
  'newOneShotMarkerAbsent',
  'previousMarkerRetained',
  'trustedLauncherInstalled',
  'trustedCredentialAvailable',
  'interactiveOrPasswordLogon',
  'profileLoadVerified',
  'independentRecoveryAvailable',
  'protectedStateAtomicRestoreAvailable'
]);

const SECRET_FIELD =
  /password|pat|secret|token|credential|auth|key|entropy|cipher/i;
export function planGateBDpapiTrial(gates = {}) {
  const unsafe = Object.entries(gates).some(
    ([k, v]) =>
      SECRET_FIELD.test(k) && !PRECONDITIONS.includes(k) && v !== undefined
  );
  const missing = PRECONDITIONS.filter((key) => gates[key] !== true);
  const tooManyAttempts = gates.maxApply !== 1;
  const wrongInterval =
    gates.guardSeconds !== undefined &&
    (!Number.isInteger(gates.guardSeconds) ||
      gates.guardSeconds < 1 ||
      gates.guardSeconds > TARGET.maxGuardSeconds);
  const fail =
    unsafe || tooManyAttempts || wrongInterval || missing.length !== 0;
  return Object.freeze({
    status: fail
      ? 'BLOCK_PRECONDITIONS_NO_GO'
      : 'OFFLINE_PLAN_ONLY_NOT_LIVE_AUTHORITY',
    missing,
    sensitiveInputDenied: unsafe,
    maxApply: 1,
    realWindowsActions: 0,
    realDpapiActions: 0,
    realCredentialsAccepted: false,
    realRunnerStarted: false,
    liveAuthorised: false,
    steps: [...STEPS]
  });
}

function snapshot(ledger, flags = {}) {
  return Object.freeze({
    status: 'OFFLINE_MODEL_NOT_REAL_PROOF',
    ledgerConsumed: ledger,
    realWindowsActions: 0,
    realDpapiActions: 0,
    realCredentialsAccepted: false,
    liveAuthorised: false,
    gate: 'NO_GO',
    ...flags
  });
}

// The mock is deterministic and never invokes injected real execution callbacks.
// A failpoint models power loss, parent kill, clock expiry and account/session drift.
export function simulateGateBSidRecovery({
  failAt = null,
  killParentAt = null,
  clockExpiredAt = null,
  processResidue = false,
  sessionResidue = false,
  wrongSid = false,
  dpapiCrossSidAccepted = false
} = {}) {
  const evidence = [];
  let consumed = false;
  let guarded = false;
  let targetEnabled = false;
  let watchdogDisableObserved = false;
  let guardRestored = false;
  let manualRestoreRequired = false;
  let residualNoGo = false;
  const failure = (reason, index) =>
    snapshot(consumed, {
      status: 'OFFLINE_INJECTED_NO_GO',
      reason,
      failedStep: STEPS[index] ?? null,
      evidence,
      guarded,
      targetEnabled,
      watchdogDisableObserved,
      // The installed Watchdog alone does not restore state or kill children.
      manualRestoreRequired: manualRestoreRequired || guarded,
      adminEmergencyDisableRequired: targetEnabled,
      independentWatchdogProofRequired: guarded,
      guardRestored,
      residualNoGo
    });

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    if (i === failAt || step === failAt) {
      // An ordinary failure is NOT proof of a dead parent, user re-disable,
      // or child cleanup. Keep dangerous state visible in the result.
      if (guarded) manualRestoreRequired = true;
      return failure('INJECTED_STEP_FAILURE', i);
    }
    if (i === killParentAt || i === clockExpiredAt) {
      if (guarded) {
        // SYSTEM watchdog is expected to attempt re-disable, but that must
        // be independently re-observed. NEVER report it as already proven.
        watchdogDisableObserved = false;
        manualRestoreRequired = true;
      }
      return failure(
        i === killParentAt ? 'PARENT_GONE' : 'DEADLINE_EXPIRED',
        i
      );
    }
    if (step.startsWith('ATOMIC_CONSUME_')) consumed = true;
    if (step.startsWith('ATOMically_ARM_')) guarded = true;
    if (step === 'ENABLE_ONLY_TARGET_ACCOUNT') targetEnabled = true;
    if (step === 'VERIFY_TARGET_SID_TOKEN_AND_PROCESS_BIRTH' && wrongSid) {
      // Never assume an untrusted child stopped or that the account disabled.
      manualRestoreRequired = guarded;
      return failure('WRONG_TARGET_SID', i);
    }
    if (
      step === 'ADMIN_OTHER_SID_DPAPI_CRYPTOGRAPHIC_REJECTION' &&
      dpapiCrossSidAccepted
    ) {
      return failure('CROSS_SID_DPAPI_ACCEPTED_CRITICAL', i);
    }
    if (step === 'DISABLE_TARGET_AND_OBSERVE_DISABLED') targetEnabled = false;
    if (
      step === 'VERIFY_NO_CHILD_PROCESS_OR_LOGON_SESSION' &&
      (processResidue || sessionResidue)
    ) {
      residualNoGo = true;
      return failure('PROCESS_OR_SESSION_RESIDUE', i);
    }
    if (step.startsWith('ATOMically_RESTORE_')) {
      guarded = false;
      guardRestored = true;
    }
    evidence.push(step);
  }
  return snapshot(consumed, {
    status: 'OFFLINE_SEQUENCE_PASS_NOT_LIVE_PROOF',
    evidence,
    guarded,
    targetEnabled,
    watchdogDisableObserved,
    guardRestored,
    manualRestoreRequired,
    residualNoGo,
    accountDisabled: true,
    processAndSessionCensus: 'MOCK_ZERO_ONLY',
    gate: 'NO_GO'
  });
}

export function realGuardedLaunchGateB() {
  return snapshot(false, {
    status: 'BLOCK_LIVE_CREDENTIAL_LAUNCH_UNIMPLEMENTED',
    realRunnerStarted: false,
    manualRestoreRequired: false
  });
}
