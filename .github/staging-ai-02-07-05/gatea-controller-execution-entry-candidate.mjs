// CODE-ONLY opt-in executable composition. Never deployed by this PR.
// Public/default export is permanently inert; no auto-discovery of keys or
// privileged clients from request bodies, GitHub comments or environment.
import { create020705TrustedControllerBootstrapCandidate } from './gatea-controller-trusted-bootstrap-candidate.mjs';

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

// Default Worker is permanently 404, even if an operator flips a flag.
// The actual authorized live entrypoint needs a separate reviewed bootstrap.
export default Object.freeze({ async fetch() { return blocked(); } });
