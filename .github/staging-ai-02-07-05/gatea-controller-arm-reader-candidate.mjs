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

// Project trusted Runner configuration to the exact signed ARM scope.
export function project020705ArmScope(scope) {
  const projected = Object.freeze(Object.fromEntries(
    [...FIELDS, ...EXTRA.filter((key) => Object.hasOwn(scope ?? {}, key))]
      .map((key) => [key, scope?.[key]])
  ));
  if (!validScope(projected)) deny();
  return projected;
}

function sameScope(a, b) {
  return validScope(a) && validScope(b) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
}

/**
 * Bind the existing Reader to a separately authenticated private Controller
 * channel. The trusted main Runner must supply that channel; never create a
 * local Controller, accept a public URL, or send signing/HMAC secrets.
 */
export function create020705RunnerArmChannelPorts({ scope, armChannel } = {}) {
  const expected = project020705ArmScope(scope);
  if (typeof armChannel?.issueArmReceipt !== 'function' ||
      typeof armChannel?.consumeArmReceipt !== 'function') deny();
  return Object.freeze({
    async readAuthenticatedArm(input, args) {
      if (!sameScope(expected, input) || !sameScope(expected, args?.scope))
        deny();
      return armChannel.issueArmReceipt(args);
    },
    async claimArmReceiptOnce(claim, envelope) {
      if (claim?.contract !== 'NOVELIGHT_AI_020705_ARM_RECEIPT_ONE_USE_V1' ||
          !claim.scope || Object.keys(claim.scope).length !== FIELDS.length ||
          !FIELDS.every((key) => claim.scope[key] === expected[key]) ||
          claim.controllerRunId !== envelope?.receipt?.controllerRunId ||
          claim.controllerKeyId !== envelope?.keyId ||
          claim.nonce !== envelope?.challengeNonce) return false;
      return (await armChannel.consumeArmReceipt(Object.freeze({
        scope: expected, envelope
      }))) === true;
    }
  });
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
  let controllerRunId = null;
  let identityFailed = false;
  let verifying = false;
  let attempted = false;
  let prepared = null;
  let delivered = false;
  let spent = false;

  function verifyEnvelope(scope, envelope) {
    return envelope?.receipt?.controllerRunId === controllerRunId &&
      verify020705SignedWatchdogArm({
        scope, envelope, trustedControllerPublicKey, trustedControllerKeyId,
        expectedChallengeNonce, now
      });
  }

  return Object.freeze({
    trustedControllerPublicKey,
    trustedControllerKeyId,
    expectedChallengeNonce,
    async verifyIndependentController(scope) {
      if (identityFailed || verifying || spent || !validScope(scope) ||
          (verifiedScope && !sameScope(verifiedScope, scope))) return false;
      verifying = true;
      try {
        const identity = await readControllerIdentity(scope);
        if (identity?.protectedEnvironment !== 'staging' ||
            identity?.controllerKind !== 'external-independent-supervisor' ||
            identity?.separateFromRunner !== true ||
            !positive(identity.controllerRunId) ||
            identity.controllerRunId === scope.runId ||
            (controllerRunId !== null &&
              controllerRunId !== identity.controllerRunId) ||
            !sameScope(identity.scope, scope) ||
            (await verifyControllerIdentityAttestation(identity, scope)) !== true)
          deny();
        verifiedScope = Object.freeze({ ...scope });
        controllerRunId = identity.controllerRunId;
        return true;
      } catch {
        identityFailed = true;
        return false;
      } finally {
        verifying = false;
      }
    },
    async inspectIndependentWatchdogArm(scope) {
      if (identityFailed || spent || !verifiedScope ||
          !sameScope(verifiedScope, scope)) deny();
      // The independent issuer atomically claims ARM before signing.
      // Inspect the same receipt without issuing a second ARM or consuming
      // ARM_RECEIPT here. The protected paid executor consumes it once.
      if (!attempted) {
        attempted = true;
        let envelope;
        try {
          envelope = await readAuthenticatedArm(verifiedScope, Object.freeze({
            scope: verifiedScope, nonce: expectedChallengeNonce,
            keyId: trustedControllerKeyId, controllerRunId
          }));
        } catch { deny(); }
        if (!verifyEnvelope(verifiedScope, envelope)) deny();
        prepared = Object.freeze({
          ...envelope, receipt: Object.freeze({ ...envelope.receipt })
        });
      }
      if (!prepared || !verifyEnvelope(verifiedScope, prepared)) deny();
      return prepared;
    },
    async readIndependentWatchdogArm(scope) {
      if (delivered || spent || identityFailed || !prepared ||
          !sameScope(verifiedScope, scope) ||
          !verifyEnvelope(verifiedScope, prepared)) deny();
      delivered = true;
      return prepared;
    },
    async consumeWatchdogChallengeOnce(challenge) {
      if (!delivered || spent || identityFailed) return false;
      spent = true;
      try {
        const { contract, controllerKeyId, nonce, ...scope } = challenge;
        if (contract !== 'NOVELIGHT_AI_020705_WATCHDOG_ONE_USE_V1' ||
            controllerKeyId !== trustedControllerKeyId ||
            nonce !== expectedChallengeNonce ||
            !sameScope(verifiedScope, scope) ||
            !verifyEnvelope(verifiedScope, prepared)) return false;
        // The existing private DO stores nine immutable run fields.
        // Candidate SHA/branch/cap were checked in the full signed receipt.
        const doScope = Object.freeze(Object.fromEntries(
          FIELDS.map((key) => [key, verifiedScope[key]])
        ));
        const claimed = await claimArmReceiptOnce(Object.freeze({
          contract: 'NOVELIGHT_AI_020705_ARM_RECEIPT_ONE_USE_V1',
          scope: doScope, controllerRunId, controllerKeyId, nonce
        }), prepared);
        return claimed === true && verifyEnvelope(verifiedScope, prepared);
      } catch { return false; }
    }
  });
}
