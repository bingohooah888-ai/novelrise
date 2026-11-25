// Recovery-only composition: never instantiate the paid runtime or provider.
// Trusted OWNER scope, capability observer and real STOP/revoke ports must
// come from a separately reviewed bootstrap, not from a request or env flag.
import { create020705AccessRecoveryClient } from '../staging-ai-02-07-05/gatea-access-recovery-client.mjs';
import { create020705TrustedIndependentRecovery } from './trusted-main-live-runtime.mjs';
import { verify020705IndependentStagingCensus } from './staging-live-bindings.mjs';
import { create020705IndependentObserverPortsCandidate } from '../staging-ai-02-07-05/gatea-controller-independent-observers-candidate.mjs';
import { create020705GithubControllerOwnerPortCandidate } from '../staging-ai-02-07-05/gatea-controller-github-owner-port-candidate.mjs';
import { create020705IndependentStopRpc, create020705IndependentSessionRevoker } from './gatea-independent-stop-ports.mjs';

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
        origin.origin !== 'https://novelight-ai-gatea-controller.bingo-hooah-888.workers.dev' ||
        !/^[a-zA-Z0-9._-]+\.access$/u.test(env.GATEA_ACCESS_CLIENT_ID ?? '') ||
        typeof env.GATEA_ACCESS_CLIENT_SECRET !== 'string' ||
        !env.GATEA_ACCESS_CLIENT_SECRET ||
        env.OPENAI_API_KEY || env.STAGING_DATABASE_URL ||
        env.GATEA_CENSUS_DATABASE_URL || env.SUPABASE_ACCESS_TOKEN ||
        env.SUPABASE_DB_PASSWORD || env.GATEA_CENSUS_READ_TOKEN) deny();
    return true;
  } catch { deny(); }
}

export function create020705IndependentRecoveryRunner({
  env, approvedOrigin, scope, controllerRunId, ownerSignature,
  pinnedControllerPublicKey, pinnedControllerKeyId, expectedChallengeNonce,
  observerOptions, ownerToken, stopOptions, stopConnectionString, syntheticJwt, syntheticSessionId
} = {}) {
  validate020705RecoveryEnvironment(env);
  if (approvedOrigin !== env.GATEA_ACCESS_ORIGIN ||
      controllerRunId !== Number(env.GITHUB_RUN_ID) ||
      !Number.isSafeInteger(controllerRunId) || controllerRunId === scope?.runId ||
      !stopOptions || ['stopModelTransport', 'disableTrialEnvironment']
        .some((k) => typeof stopOptions[k] !== 'function')) deny();
  const accessClient = create020705AccessRecoveryClient({
    origin: approvedOrigin, clientId: env.GATEA_ACCESS_CLIENT_ID,
    clientSecret: env.GATEA_ACCESS_CLIENT_SECRET, ownerSignature, scope,
    controllerRunId, trustedControllerPublicKey: pinnedControllerPublicKey,
    trustedControllerKeyId: pinnedControllerKeyId, expectedChallengeNonce
  });
  // Reuse the existing signed independent observer and OWNER ledger adapters.
  // No PAT, mock boolean, or generic DB login can certify census.
  const observer = create020705IndependentObserverPortsCandidate(observerOptions);
  const owner = create020705GithubControllerOwnerPortCandidate({
    token: ownerToken, controllerRunId,
    verifyIndependentControllerIdentity: observer.verifyIndependentControllerIdentity
  });
  const stopRuntime = create020705IndependentStopRpc({
    connectionString: stopConnectionString, scope
  });
  const revokeSyntheticSessions = create020705IndependentSessionRevoker({
    scope, serviceClient: stopOptions.serviceClient, authAdmin: stopOptions.authAdmin,
    jwt: syntheticJwt, sessionId: syntheticSessionId
  });
  const independentCensus = async (target) => {
    const report = await observer.independentCensus(target);
    if (!await verify020705IndependentStagingCensus({
      scope, independentCensus: async () => report
    })) deny();
    return report;
  };
  let attempted = false;
  return Object.freeze({ async recoverOnce() {
    if (attempted) deny();
    attempted = true;
    const query = Object.freeze({ repository: scope.repository,
      stagingProjectRef: scope.stagingProjectRef, runId: scope.runId,
      approvalCommentId: scope.approvalCommentId });
    const trusted = await owner.readOwnerApprovedScope(query);
    if (!await owner.verifyOwnerApprovalAttestation(trusted, query) ||
        Object.keys(trusted.scope ?? {}).length !== Object.keys(scope).length ||
        !Object.keys(scope).every((key) => trusted.scope[key] === scope[key])) deny();
    const detached = create020705TrustedIndependentRecovery({
      scope, controllerRunId, pinnedControllerPublicKey, pinnedControllerKeyId,
      expectedChallengeNonce, accessClient,
      readControllerCapabilities: async () => {
        const proof = await observer.readIndependentCapabilities(trusted);
        if (!await observer.verifyCapabilityAttestation(proof, trusted)) deny();
        return proof;
      },
      stopOptions: { ...stopOptions, stopRuntime, revokeSyntheticSessions, independentCensus }
    });
    return detached.recover();
  } });
}
