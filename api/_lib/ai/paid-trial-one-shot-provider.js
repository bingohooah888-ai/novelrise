// Compatibility entry for the 02-07-05 Staging-only one-shot provider.
// The implementation and its WeakMap identity live in the trusted control
// source tree; this file does not create a second provider or execution path.
export {
  createPaidTrialOneShotOpenAiProvider,
  isPaidTrialOneShotGuardedProvider,
  matchesPaidTrialOneShotGuardedProviderScope
} from '../../../.github/staging-ai-02-07-05/paid-trial-one-shot-provider.mjs';
