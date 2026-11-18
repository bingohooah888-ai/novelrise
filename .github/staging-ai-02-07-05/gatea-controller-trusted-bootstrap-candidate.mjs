// CODE ONLY. Never import this candidate as the deployed Worker's default.
// The approved Controller runtime must inject independently authenticated
// OWNER approvals, capability proofs and Staging-only execution ports.
import { create020705ControllerCandidate } from './cloudflare-gatea-controller-candidate.mjs';
import { create020705ControllerArmIssuer } from './gatea-controller-arm-issuer-candidate.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + STAGING + '.supabase.co';
const positive = (v) => Number.isSafeInteger(v) && v > 0;
function deny() { throw new Error('AI_020705_CONTROLLER_BOOTSTRAP_NO_GO'); }
function matchingScope(a, b) {
  return a?.repository === REPO && a.stagingProjectRef === STAGING &&
    a.runId === b?.runId && a.approvalCommentId === b?.approvalCommentId;
}

/**
 * Dependencies are intentionally not implemented with HTTP defaults.
 * The real runtime must install off-Runner pinned trust, immutable OWNER
 * scope reads, a separately signed Controller identity, independent provider
 * STOP, Staging AI OFF, synthetic JWT revocation, and independent readback.
 * Failing to independently verify any authority MUST prevent privileged I/O.
 */
export function create020705TrustedControllerBootstrapCandidate({
  readOwnerApprovedScope, verifyOwnerApprovalAttestation,
  readIndependentCapabilities, verifyCapabilityAttestation,
  makeStagingStopPorts, verifyStagingPortAttestation,
  inspectIndependentArm, claimArmOnce, signWithControllerKey,
  now = Date.now
} = {}) {
  if (![readOwnerApprovedScope, verifyOwnerApprovalAttestation,
    readIndependentCapabilities, verifyCapabilityAttestation,
    makeStagingStopPorts, verifyStagingPortAttestation,
    inspectIndependentArm, claimArmOnce, signWithControllerKey, now]
    .every((fn) => typeof fn === 'function')) deny();
  const controller = create020705ControllerCandidate({
    async resolveTrustedRun(query) {
      const approval = await readOwnerApprovedScope(query);
      if (approval?.repository !== REPO ||
          approval?.stagingProjectRef !== STAGING ||
          approval.runId !== query.runId ||
          approval.approvalCommentId !== query.approvalCommentId ||
          approval?.ownerApproved !== true ||
          approval?.sourceVerified !== true ||
          !positive(approval.controllerRunId) ||
          approval.controllerRunId === query.runId ||
          !matchingScope(approval.scope, query) ||
          (await verifyOwnerApprovalAttestation(approval, query)) !== true)
        deny();
      return Object.freeze(approval);
    },
    async readIndependentCapabilities(trusted) {
      const capabilities = await readIndependentCapabilities(trusted);
      if ((await verifyCapabilityAttestation(capabilities, trusted)) !== true)
        deny();
      return capabilities;
    },
    async makeStagingStopPorts(trusted) {
      const ports = await makeStagingStopPorts(trusted);
      if (ports?.synthetic?.verifiedSynthetic !== true ||
          ports.synthetic.projectRef !== STAGING ||
          ports.synthetic.supabaseUrl !== URL ||
          ports.synthetic.userId !== trusted.scope.actorId ||
          ports.synthetic.novelId !== trusted.scope.novelId ||
          ports.synthetic.approvalCommentId !== trusted.scope.approvalCommentId ||
          ports?.serviceClient?.supabaseUrl !== URL ||
          typeof ports?.authAdmin?.getUserById !== 'function' ||
          typeof ports?.authAdmin?.deleteUser !== 'function' ||
          (await verifyStagingPortAttestation(ports, trusted)) !== true) deny();
      return ports;
    }
  });
  const issuer = create020705ControllerArmIssuer({
    inspectIndependentArm, claimArmOnce, signWithControllerKey, now
  });
  return Object.freeze({
    fetch: (request, env) => controller.fetch(request, env),
    issueArmReceipt: (args) => issuer.issue(args)
  });
}
