// Recovery-only composition: never instantiate the paid runtime or provider.
// Trusted OWNER scope, capability observer and real STOP/revoke ports must
// come from a separately reviewed bootstrap, not from a request or env flag.
import { create020705AccessRecoveryClient } from '../staging-ai-02-07-05/gatea-access-recovery-client.mjs';
import { create020705TrustedIndependentRecovery } from './trusted-main-live-runtime.mjs';
import { verify020705IndependentStagingCensus } from './staging-live-bindings.mjs';
import { create020705IndependentCensusReader, validate020705CensusUrl } from './gatea-independent-census.mjs';

function deny() { throw new Error('AI_020705_INDEPENDENT_RUNNER_NO_GO'); }

export function validate020705RecoveryEnvironment(env = {}) {
  try {
    const origin = new URL(env.GATEA_ACCESS_ORIGIN);
    if (env.GITHUB_REPOSITORY !== 'bingohooah888-ai/novelrise' ||
        env.GITHUB_REF !== 'refs/heads/main' ||
        env.GITHUB_ACTOR !== 'bingohooah888-ai' ||
        env.GITHUB_TRIGGERING_ACTOR !== 'bingohooah888-ai' ||
        env.GITHUB_RUN_ATTEMPT !== '1' ||
        !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? '') ||
        origin.protocol !== 'https:' || origin.origin !== env.GATEA_ACCESS_ORIGIN ||
        !/^novelight-ai-gatea-controller\.[a-z0-9-]+\.workers\.dev$/u.test(origin.hostname) ||
        !/^[a-zA-Z0-9._-]+\.access$/u.test(env.GATEA_ACCESS_CLIENT_ID ?? '') ||
        typeof env.GATEA_ACCESS_CLIENT_SECRET !== 'string' ||
        !env.GATEA_ACCESS_CLIENT_SECRET ||
        env.OPENAI_API_KEY || env.STAGING_DATABASE_URL) deny();
    validate020705CensusUrl(env.GATEA_CENSUS_DATABASE_URL);
    return true;
  } catch { deny(); }
}

export function create020705IndependentRecoveryRunner({
  env, approvedOrigin, scope, controllerRunId, ownerSignature,
  pinnedControllerPublicKey, pinnedControllerKeyId, expectedChallengeNonce,
  readControllerCapabilities, stopOptions
} = {}) {
  validate020705RecoveryEnvironment(env);
  if (approvedOrigin !== env.GATEA_ACCESS_ORIGIN ||
      controllerRunId !== Number(env.GITHUB_RUN_ID) ||
      !Number.isSafeInteger(controllerRunId) || controllerRunId === scope?.runId ||
      typeof readControllerCapabilities !== 'function' ||
      !stopOptions || ['stopModelTransport', 'disableTrialEnvironment',
        'revokeSyntheticSessions'].some((k) => typeof stopOptions[k] !== 'function')) deny();
  const accessClient = create020705AccessRecoveryClient({
    origin: approvedOrigin, clientId: env.GATEA_ACCESS_CLIENT_ID,
    clientSecret: env.GATEA_ACCESS_CLIENT_SECRET, ownerSignature, scope,
    controllerRunId, trustedControllerPublicKey: pinnedControllerPublicKey,
    trustedControllerKeyId: pinnedControllerKeyId, expectedChallengeNonce
  });
  const reader = create020705IndependentCensusReader({
    connectionString: env.GATEA_CENSUS_DATABASE_URL, scope
  });
  const independentCensus = async (target) => {
    const report = await reader(target);
    if (!await verify020705IndependentStagingCensus({
      scope, independentCensus: async () => report
    })) deny();
    return report;
  };
  const detached = create020705TrustedIndependentRecovery({
    scope, controllerRunId, pinnedControllerPublicKey, pinnedControllerKeyId,
    expectedChallengeNonce, readControllerCapabilities, accessClient,
    stopOptions: { ...stopOptions, independentCensus }
  });
  return Object.freeze({ recoverOnce: () => detached.recover() });
}
