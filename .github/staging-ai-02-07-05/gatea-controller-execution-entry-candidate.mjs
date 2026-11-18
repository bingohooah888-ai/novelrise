// CODE-ONLY opt-in executable composition. Never deployed by this PR.
// Public/default export is permanently inert; no auto-discovery of keys or
// privileged clients from request bodies, GitHub comments or environment.
import { create020705TrustedControllerBootstrapCandidate } from './gatea-controller-trusted-bootstrap-candidate.mjs';
import { create020705GithubControllerOwnerPortCandidate } from './gatea-controller-github-owner-port-candidate.mjs';
import { create020705IndependentObserverPortsCandidate } from './gatea-controller-independent-observers-candidate.mjs';

function blocked() {
  return new Response(null, {
    status: 404, headers: { 'cache-control': 'no-store' }
  });
}
function deny() { throw new Error('AI_020705_CONTROLLER_ENTRY_NO_GO'); }

/**
 * A later independently reviewed bootstrap may pass authenticated real
 * implementations of the existing ports. This file does NOT implement those
 * privileges, and cannot be used as evidence that they are available.
 */
export function create020705ControllerExecutionEntryCandidate(ports = {}) {
  const dependencies = [
    'readOwnerApprovedScope', 'verifyOwnerApprovalAttestation',
    'readIndependentCapabilities', 'verifyCapabilityAttestation',
    'makeStagingStopPorts', 'verifyStagingPortAttestation',
    'inspectIndependentArm', 'signWithControllerKey'
  ];
  if (!ports || dependencies.some((key) => typeof ports[key] !== 'function'))
    deny();
  const runtime = create020705TrustedControllerBootstrapCandidate(ports);
  return Object.freeze({
    async fetch(request, env) {
      // Hard opt-in: the candidate config always leaves both flags false.
      if (env?.GATEA_CONTROLLER_LIVE_ENABLED !== 'true' ||
          env?.GATEA_CONTROLLER_RECOVERY_ADMISSION_ENABLED !== 'true' ||
          typeof env?.GATEA_CLAIM_HMAC_KEY !== 'string' ||
          typeof env?.GATEA_CLAIM_LEDGER?.idFromName !== 'function')
        return blocked();
      try { return await runtime.fetch(request, env); }
      catch { return blocked(); }
    },
    async issueArmReceipt(args, env) {
      if (env?.GATEA_CONTROLLER_LIVE_ENABLED !== 'true' ||
          env?.GATEA_CONTROLLER_RECOVERY_ADMISSION_ENABLED !== 'true' ||
          typeof env?.GATEA_CLAIM_HMAC_KEY !== 'string' ||
          typeof env?.GATEA_CLAIM_LEDGER?.idFromName !== 'function') deny();
      return runtime.issueArmReceipt(args, env);
    }
  });
}

/**
 * Code-only owner-authenticated composition for future isolated deployment.
 * This is not the default: real stop, revoke, census and identity ports must
 * be independently provisioned and reviewed before activation.
 */
export function create020705GithubBoundControllerEntryCandidate(ports = {}) {
  if (typeof ports.verifyIndependentControllerIdentity !== 'function')
    deny();
  return Object.freeze({
    async fetch(request, env) {
      if (env?.GATEA_CONTROLLER_LIVE_ENABLED !== 'true' ||
          env?.GATEA_CONTROLLER_RECOVERY_ADMISSION_ENABLED !== 'true')
        return blocked();
      try {
        const owner = create020705GithubControllerOwnerPortCandidate({
          token: env.GATEA_GITHUB_ISSUES_READ_TOKEN,
          controllerRunId: Number(env.GATEA_CONTROLLER_RUN_ID),
          verifyIndependentControllerIdentity:
            ports.verifyIndependentControllerIdentity
        });
        return await create020705ControllerExecutionEntryCandidate({
          ...ports, ...owner
        }).fetch(request, env);
      } catch { return blocked(); }
    }
  });
}

/**
 * Explicit opt-in bridge to independently signed identity/capability and
 * separately signed read-only census services. No public default routes.
 * This does NOT provision those services, their keys, Staging credentials,
 * provider cancellation, Preview suspension, or real off-quota authority.
 */
export function create020705SignedObserverBoundControllerEntryCandidate(ports = {}) {
  if (typeof ports.makeStagingStopPorts !== 'function' ||
      typeof ports.verifyStagingPortAttestation !== 'function' ||
      typeof ports.inspectIndependentArm !== 'function' ||
      typeof ports.signWithControllerKey !== 'function') deny();
  return Object.freeze({
    async fetch(request, env) {
      if (env?.GATEA_CONTROLLER_LIVE_ENABLED !== 'true' ||
          env?.GATEA_CONTROLLER_RECOVERY_ADMISSION_ENABLED !== 'true')
        return blocked();
      try {
        const observer = create020705IndependentObserverPortsCandidate({
          identityService: env.GATEA_IDENTITY_OBSERVER,
          censusService: env.GATEA_CENSUS_OBSERVER,
          identityPublicKey: env.GATEA_IDENTITY_PUB_SPKI,
          censusPublicKey: env.GATEA_CENSUS_PUB_SPKI,
          identityKeyId: env.GATEA_IDENTITY_KEY_ID,
          censusKeyId: env.GATEA_CENSUS_KEY_ID,
          expectedWatchdogVersionId: env.GATEA_WATCHDOG_PINNED_VERSION_ID,
          expectedWatchdogArtifactSha256:
            env.GATEA_WATCHDOG_PINNED_ARTIFACT_SHA256
        });
        const entry = create020705GithubBoundControllerEntryCandidate({
          ...ports,
          ...observer,
          makeStagingStopPorts: async (trusted) => {
            const supplied = await ports.makeStagingStopPorts(trusted);
            if (!supplied || typeof supplied !== 'object') deny();
            return Object.freeze({
              ...supplied, independentCensus: observer.independentCensus
            });
          }
        });
        return await entry.fetch(request, env);
      } catch { return blocked(); }
    }
  });
}

// Default Worker is permanently 404, even if an operator flips a flag.
// The actual authorized live entrypoint needs a separate reviewed bootstrap.
export default Object.freeze({ async fetch() { return blocked(); } });
