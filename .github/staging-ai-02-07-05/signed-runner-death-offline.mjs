// NOVELIGHT AI 02-07-05 — signature of an OFFLINE synthetic death report.
// This is NOT proof of real controller isolation, runner death or kill authority.
// Authenticity depends on an independently trusted, pinned Ed25519 public key
// and a fresh challenge, neither of which can come from the submitted envelope.
import { createPublicKey, verify } from 'node:crypto';

const DOMAIN = 'NOVELIGHT_AI_020705_DETACHED_DEATH_V1';
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const KEY_ID = /^[A-Za-z0-9_-]{8,64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const ENVELOPE_KEYS = [
  'domain', 'keyId', 'challengeNonce', 'proof', 'signature'
];
const PROOF_KEYS = [
  'repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
  'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId',
  'kind', 'runnerConfirmedDead', 'controllerIsRunner', 'controllerRunId',
  'observedAtMs', 'runnerHeartbeatAtMs', 'expiresAtMs'
];
// prettier-ignore
function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Exact V1 signature bytes: JSON.stringify([DOMAIN, keyId, nonce, proof]).
 * A valid signature alone does not prove the claims inside the proof.
 * A separate trusted atomic one-shot consumer is mandatory to reject replay.
 */
export function verify020705SignedRunnerDeath({
  envelope,
  trustedControllerPublicKey,
  trustedControllerKeyId,
  expectedChallengeNonce
} = {}) {
  try {
    if (!exactKeys(envelope, ENVELOPE_KEYS) ||
        !exactKeys(envelope.proof, PROOF_KEYS) ||
        envelope.domain !== DOMAIN ||
        !KEY_ID.test(trustedControllerKeyId ?? '') ||
        envelope.keyId !== trustedControllerKeyId ||
        !NONCE.test(expectedChallengeNonce ?? '') ||
        envelope.challengeNonce !== expectedChallengeNonce ||
        !SIGNATURE.test(envelope.signature ?? '')) return false;
    const key = trustedControllerPublicKey?.type === 'public' &&
      trustedControllerPublicKey?.asymmetricKeyType === 'ed25519'
      ? trustedControllerPublicKey
      : createPublicKey(trustedControllerPublicKey);
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
      return false;
    }
    const signature = Buffer.from(envelope.signature, 'base64url');
    if (signature.length !== 64 ||
        signature.toString('base64url') !== envelope.signature) return false;
    const payload = Buffer.from(JSON.stringify([
      DOMAIN, envelope.keyId, expectedChallengeNonce, envelope.proof
    ]), 'utf8');
    return verify(null, payload, key, signature);
  } catch {
    return false;
  }
}
