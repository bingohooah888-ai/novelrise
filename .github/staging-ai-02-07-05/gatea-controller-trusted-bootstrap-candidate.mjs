// CODE ONLY. Never import this candidate as the deployed Worker's default.
// The approved Controller runtime must inject independently authenticated
// OWNER approvals, capability proofs and Staging-only execution ports.
import { create020705ControllerCandidate } from './cloudflare-gatea-controller-candidate.mjs';
import { create020705ControllerArmIssuer } from './gatea-controller-arm-issuer-candidate.mjs';
import { create020705PrivateDoClaimPort } from './gatea-controller-do-claim-port-candidate.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + STAGING + '.supabase.co';
const positive = (v) => Number.isSafeInteger(v) && v > 0;
function deny() { throw new Error('AI_020705_CONTROLLER_BOOTSTRAP_NO_GO'); }
const SCOPE_KEYS = [
  'repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
  'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'
];
const OPTIONAL_SCOPE_KEYS = ['candidateSha', 'stagingBranch', 'capMicros'];
function matchingQuery(a, b) {
  return a?.repository === REPO && a?.stagingProjectRef === STAGING &&
    b?.repository === REPO && b?.stagingProjectRef === STAGING &&
    positive(a?.runId) && a.runId === b?.runId &&
    positive(a?.approvalCommentId) &&
    a.approvalCommentId === b?.approvalCommentId;
}
function matchingScope(a, b) {
  if (!matchingQuery(a, b) || !a || !b ||
      Object.keys(a).length !== Object.keys(b).length ||
      Object.keys(a).some((key) =>
        !SCOPE_KEYS.includes(key) && !OPTIONAL_SCOPE_KEYS.includes(key)) ||
      !SCOPE_KEYS.every((key) =>
        Object.hasOwn(a, key) && Object.hasOwn(b, key) &&
        a[key] === b[key])) return false;
  return Object.keys(a).every((key) =>
    Object.hasOwn(b, key) && a[key] === b[key]);
}
function independentlyApproved(approval, query) {
  return approval?.repository === REPO &&
    approval?.stagingProjectRef === STAGING &&
    approval?.runId === query?.runId &&
    approval?.approvalCommentId === query?.approvalCommentId &&
    approval?.ownerApproved === true &&
    approval?.sourceVerified === true &&
    positive(approval?.controllerRunId) &&
    approval.controllerRunId !== query.runId &&
    matchingQuery(approval.scope, query);
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
  inspectIndependentArm, signWithControllerKey,
  now = Date.now
} = {}) {
  if (![readOwnerApprovedScope, verifyOwnerApprovalAttestation,
    readIndependentCapabilities, verifyCapabilityAttestation,
    makeStagingStopPorts, verifyStagingPortAttestation,
    inspectIndependentArm, signWithControllerKey, now]
    .every((fn) => typeof fn === 'function')) deny();
  const controller = create020705ControllerCandidate({
    async resolveTrustedRun(query) {
      const approval = await readOwnerApprovedScope(query);
      if (!independentlyApproved(approval, query) ||
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
    async makeStagingStopPorts(trusted, env) {
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
      const claims = create020705PrivateDoClaimPort({
        namespace: env?.GATEA_CLAIM_LEDGER,
        hmacSecret: env?.GATEA_CLAIM_HMAC_KEY,
        scope: trusted.scope, controllerRunId: trusted.controllerRunId
      });
      // Caller-supplied mocks never satisfy the real recovery claim port.
      return Object.freeze({ ...ports, claimRecoveryOnce: claims.claimRecoveryOnce });
    }
  });
  return Object.freeze({
    fetch: (request, env) => controller.fetch(request, env),
    async issueArmReceipt(args, env) {
      if (env?.GATEA_CONTROLLER_LIVE_ENABLED !== 'true' ||
          !args?.scope || !positive(args.controllerRunId)) deny();
      // Before issuing a signed pre-paid ARM, authenticate the actual OWNER
      // approval and every immutable scope field against a separate source.
      // A signed ARM itself is never evidence of stop/revoke authority.
      const query = Object.freeze({
        repository: REPO, stagingProjectRef: STAGING,
        runId: args.scope.runId,
        approvalCommentId: args.scope.approvalCommentId
      });
      let approval;
      try { approval = await readOwnerApprovedScope(query); }
      catch { deny(); }
      if (!independentlyApproved(approval, query) ||
          approval.controllerRunId !== args.controllerRunId ||
          !matchingScope(approval.scope, args.scope) ||
          (await verifyOwnerApprovalAttestation(approval, query)) !== true)
        deny();
      let capabilities;
      try { capabilities = await readIndependentCapabilities(approval); }
      catch { deny(); }
      if (capabilities?.verifiedIndependentSource !== true ||
          capabilities?.separateFromRunner !== true ||
          capabilities?.stagingStopAuthorityVerified !== true ||
          capabilities?.syntheticRevocationVerified !== true ||
          capabilities?.independentCensusVerified !== true ||
          (await verifyCapabilityAttestation(capabilities, approval)) !== true)
        deny();
      // ARM may include candidateSha/stagingBranch/capMicros, but the
      // original DO ledger stores only the nine immutable run fields.
      const fields = [
        'repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
        'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'
      ];
      const doScope = Object.fromEntries(
        fields.map((key) => [key, args?.scope?.[key]])
      );
      const claims = create020705PrivateDoClaimPort({
        namespace: env.GATEA_CLAIM_LEDGER,
        hmacSecret: env.GATEA_CLAIM_HMAC_KEY,
        scope: doScope, controllerRunId: args?.controllerRunId
      });
      const issuer = create020705ControllerArmIssuer({
        inspectIndependentArm,
        claimArmOnce: (claim) => {
          if (claim?.scope !== args?.scope ||
              claim?.nonce !== args?.nonce ||
              claim?.controllerRunId !== args?.controllerRunId) deny();
          return claims.claimArmOnce({
            scope: doScope, nonce: claim.nonce,
            controllerRunId: claim.controllerRunId
          });
        },
        signWithControllerKey, now
      });
      return issuer.issue(args);
    }
  });
}
