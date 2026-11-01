// 02-07-05 dormant Staging-only runner core. It has NO CLI entrypoint,
// network client, secrets or workflow trigger. A separately approved protected
// workflow must inject verified callbacks and the guarded provider; this file
// must NEVER be used to turn AI on or provision a user.
import { isPaidTrialOneShotGuardedProvider } from
  '../../api/_lib/ai/paid-trial-one-shot-provider.js';

function deny() {
  throw new Error('AI_020705_PAID_RUNNER_DENIED');
}

export async function run020705SinglePaidTrial({
  claimed,
  guardedProvider,
  request,
  stop,
  cleanup,
  finalCensus,
  phase = () => {}
} = {}) {
  if (
    claimed?.ownerLedgerClaimed !== true ||
    claimed?.authorizesPaidCall !== false ||
    !isPaidTrialOneShotGuardedProvider(guardedProvider) ||
    request?.model !== 'gpt-5.6-luna' ||
    typeof request.system !== 'string' ||
    typeof request.user !== 'string' ||
    request.user.length > 36000 ||
    typeof stop !== 'function' ||
    typeof cleanup !== 'function' ||
    typeof finalCensus !== 'function' ||
    typeof phase !== 'function'
  ) {
    deny();
  }

  let callFailed = false;
  let cleanupFailed = false;
  try {
    phase('PAID_ONE_SHOT_POST_ATTEMPT');
    // The provider itself claims a unique DB row atomically IMMEDIATELY
    // before its only external POST. No retry or fallback is permitted.
    const response = await guardedProvider.generate(request);
    if (typeof response?.text !== 'string' || !response.text.trim()) {
      callFailed = true;
    }
  } catch {
    callFailed = true;
    phase('PAID_ONE_SHOT_CALL_FAILED');
  } finally {
    // Best effort must not mean silent success: ALWAYS attempt all three,
    // even when a previous stage throws or reports false. Failure persists.
    phase('KILL_SWITCH_AND_ZERO_BUDGET');
    try {
      if ((await stop()) !== true) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
    phase('SYNTHETIC_FIXTURE_CLEANUP');
    try {
      if ((await cleanup()) !== true) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
    phase('INDEPENDENT_FINAL_CENSUS');
    try {
      if ((await finalCensus()) !== true) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    phase('CLEANUP_OR_CENSUS_FAILED');
    throw new Error('AI_020705_PAID_CLEANUP_UNVERIFIED');
  }
  if (callFailed) {
    throw new Error('AI_020705_PAID_ATTEMPT_FAILED_NO_RETRY');
  }
  phase('SINGLE_CALL_PASS_WITH_CENSUS');
  // Only sanitized status is returned, never raw provider text or secrets.
  return Object.freeze({
    outcome: 'one_call_succeeded_and_cleanup_verified',
    provider: 'openai',
    model: 'gpt-5.6-luna'
  });
}
