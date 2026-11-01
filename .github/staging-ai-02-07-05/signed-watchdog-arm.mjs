// NOVELIGHT AI 02-07-05 Gate A: signed receipt verification (OFFLINE ONLY).
// This module does NOT fetch trust keys, issue receipts, claim approvals,
// dispatch workflows, operate a watchdog, stop AI, or mutate an environment.
// A future independent controller must hold the private key OUTSIDE Runner.
import { createPublicKey, verify } from 'node:crypto';
import { matches020705WatchdogArm } from './independent-watchdog-arm.mjs';

const DOMAIN = 'NOVELIGHT_AI_020705_WATCHDOG_ARM_V1';
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const KEY_ID = /^[A-Za-z0-9_-]{8,64}$/u;

function exactKeys(obj, names) {
  return obj && typeof obj === 'object' && !Array.isArray(obj) &&
    Object.keys(obj).length === names.length &&
    Object.keys(obj).every((key) => names.includes(key));
}

/**
 * Both trustedControllerPublicKey and expectedChallengeNonce MUST come from
 * independently authenticated, OWNER-approved trusted runner configuration.
 * Never take either from the submitted envelope or its transport metadata.
 * Replay protection across jobs requires a separate atomic one-use ledger.
 * A valid signature cannot prove real kill, revoke, or cleanup authority.
 */
export function verify020705SignedWatchdogArm({
  scope,
  envelope,
  trustedControllerPublicKey,
  trustedControllerKeyId,
  expectedChallengeNonce,
  now = Date.now
} = {}) {
  try {
    if (!exactKeys(envelope, [
      'domain', 'keyId', 'challengeNonce', 'receipt', 'signature'
    ]) ||
      envelope.domain !== DOMAIN ||
      !KEY_ID.test(trustedControllerKeyId ?? '') ||
      envelope.keyId !== trustedControllerKeyId ||
      !NONCE.test(expectedChallengeNonce ?? '') ||
      envelope.challengeNonce !== expectedChallengeNonce ||
      !SIGNATURE.test(envelope.signature ?? '') ||
      typeof now !== 'function' ||
      !matches020705WatchdogArm({scope, receipt: envelope.receipt, now})) {
      return false;
    }
    const publicKey = trustedControllerPublicKey?.type === 'public' &&
      trustedControllerPublicKey?.asymmetricKeyType === 'ed25519'
      ? trustedControllerPublicKey
      : createPublicKey(trustedControllerPublicKey);
    if (publicKey.asymmetricKeyType !== 'ed25519' || publicKey.type !== 'public') {
      return false;
    }
    const signature = Buffer.from(envelope.signature, 'base64url');
    if (signature.length !== 64 || signature.toString('base64url') !== envelope.signature) {
      return false;
    }
    // V1 signed format: UTF-8 JSON array with this exact field order.
    const payload = Buffer.from(JSON.stringify([
      DOMAIN,
      envelope.keyId,
      expectedChallengeNonce,
      envelope.receipt
    ]), 'utf8');
    return verify(null, payload, publicKey, signature);
  } catch {
    // Never echo credentials, signed content, or crypto error details.
    return false;
  }
}
