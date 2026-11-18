// CODE ONLY. Read a signed independent ARM receipt through a future
// authenticated, isolated Controller channel. No transport or secrets here.
import { verify020705SignedWatchdogArm } from './signed-watchdog-arm.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const KEY_ID = /^[A-Za-z0-9_-]{8,64}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const PREVIEW = /^dpl_[A-Za-z0-9]+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FIELDS = [
  'repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
  'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'
];
const EXTRA = ['candidateSha', 'stagingBranch', 'capMicros'];
const positive = (v) => Number.isSafeInteger(v) && v > 0;
function deny() { throw new Error('AI_020705_ARM_READER_NO_GO'); }

function validScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) ||
      !FIELDS.every((k) => Object.hasOwn(scope, k)) ||
      Object.keys(scope).some((k) => !FIELDS.includes(k) && !EXTRA.includes(k)) ||
      scope.repository !== REPO || scope.stagingProjectRef !== STAGING ||
      !SHA.test(scope.mainSha ?? '') ||
      !PREVIEW.test(scope.previewDeploymentId ?? '') ||
      !UUID.test(scope.actorId ?? '') ||
      !['novelId', 'episodeId', 'runId', 'approvalCommentId'].every((k) =>
        positive(scope[k]))) return false;
  const hasExtra = EXTRA.some((k) => Object.hasOwn(scope, k));
  return !hasExtra || (EXTRA.every((k) => Object.hasOwn(scope, k)) &&
    SHA.test(scope.candidateSha ?? '') && scope.candidateSha !== scope.mainSha &&
    /^staging\/ai-02-07-05-[a-z0-9-]+$/u.test(scope.stagingBranch ?? '') &&
    positive(scope.capMicros) && scope.capMicros <= 10000000);
}

function sameScope(a, b) {
  return validScope(a) && validScope(b) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
}

/**
 * Every injected callback MUST come from a separately authenticated source.
 * verifyControllerIdentityAttestation MUST use pinned independent trust,
 * not a metadata boolean. claimArmReceiptOnce MUST use a durable, shared,
 * single-winner ledger. An in-memory Set is not a live implementation.
 */
export function create020705AuthenticatedArmReaderCandidate({
  readControllerIdentity, verifyControllerIdentityAttestation,
  readAuthenticatedArm, claimArmReceiptOnce, trustedControllerPublicKey,
  trustedControllerKeyId, expectedChallengeNonce, now = Date.now
} = {}) {
  if (![readControllerIdentity, verifyControllerIdentityAttestation,
    readAuthenticatedArm, claimArmReceiptOnce, now]
    .every((fn) => typeof fn === 'function') ||
    !trustedControllerPublicKey ||
    !KEY_ID.test(trustedControllerKeyId ?? '') ||
    !NONCE.test(expectedChallengeNonce ?? '')) deny();
  let verifiedScope = null;
  let attempted = false;
  return Object.freeze({
    trustedControllerPublicKey,
    trustedControllerKeyId,
    expectedChallengeNonce,
    async verifyIndependentController(scope) {
      if (verifiedScope || attempted || !validScope(scope)) return false;
      try {
        const identity = await readControllerIdentity(scope);
        if (identity?.protectedEnvironment !== 'staging' ||
            identity?.controllerKind !== 'external-independent-supervisor' ||
            identity?.separateFromRunner !== true ||
            !positive(identity.controllerRunId) ||
            identity.controllerRunId === scope.runId ||
            !sameScope(identity.scope, scope) ||
            (await verifyControllerIdentityAttestation(identity, scope)) !== true)
          return false;
        verifiedScope = Object.freeze({ ...scope });
        return true;
      } catch { return false; }
    },
    async readIndependentWatchdogArm(scope) {
      if (attempted || !verifiedScope || !sameScope(verifiedScope, scope)) deny();
      attempted = true;
      let envelope;
      try { envelope = await readAuthenticatedArm(scope); }
      catch { deny(); }
      if (!verify020705SignedWatchdogArm({
        scope, envelope, trustedControllerPublicKey, trustedControllerKeyId,
        expectedChallengeNonce, now
      })) deny();
      let claimed = false;
      try {
        claimed = (await claimArmReceiptOnce(Object.freeze({
          contract: 'NOVELIGHT_AI_020705_ARM_RECEIPT_ONE_USE_V1',
          ...verifiedScope,
          controllerKeyId: trustedControllerKeyId,
          nonce: expectedChallengeNonce
        }))) === true;
      } catch { deny(); }
      if (!claimed) deny();
      return envelope;
    }
  });
}
