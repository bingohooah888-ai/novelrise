import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const CONTEST_GUEST_COOKIE = '__Host-nl_contest_guest';
const TOKEN_VERSION = 'v1';
const TOKEN_MAX_AGE_MS = 40 * 24 * 60 * 60 * 1000;
const HEX_48 = /^[a-f0-9]{48}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const CONTEST_KEY_RE = /^[a-z0-9][a-z0-9_-]{2,79}$/;

function checkSecret(secret, forbidden = []) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Contest guest signing secret must be at least 32 bytes');
  }
  if (forbidden.some(value => value && value === secret)) {
    throw new Error('Contest guest signing secret must be purpose-specific');
  }
  return secret;
}

function checkContestKey(key) {
  if (typeof key !== 'string' || !CONTEST_KEY_RE.test(key)) {
    throw new Error('Invalid contest key');
  }
  return key;
}

function keyedHash(secret, purpose, value) {
  return createHmac('sha256', secret)
    .update('novelight:contest-guest:' + purpose + ':' + String(value))
    .digest('hex');
}

/**
 * Issue a server-signed, unguessable first-party guest credential.
 * NEVER treat this cookie as evidence that the bearer is a unique human.
 */
export function issueContestGuestCredential({
  secret,
  contestKey,
  now = Date.now(),
  nonce = randomBytes(24).toString('hex')
}) {
  checkSecret(secret);
  checkContestKey(contestKey);
  if (!Number.isSafeInteger(now) || now < 0 || !HEX_48.test(nonce)) {
    throw new Error('Invalid credential issuance parameters');
  }
  const issued = now.toString(36);
  const payload = TOKEN_VERSION + '.' + issued + '.' + nonce;
  const mac = keyedHash(secret, 'cookie:' + contestKey, payload);
  return {
    token: payload + '.' + mac,
    guestHash: keyedHash(secret, 'identity:' + contestKey, nonce),
    cookie:
      CONTEST_GUEST_COOKIE + '=' + payload + '.' + mac +
      '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' +
      Math.floor(TOKEN_MAX_AGE_MS / 1000)
  };
}

export function verifyContestGuestCredential({
  token,
  secret,
  contestKey,
  now = Date.now()
}) {
  checkSecret(secret);
  checkContestKey(contestKey);
  if (typeof token !== 'string' || token.length > 180 || !Number.isSafeInteger(now)) {
    return null;
  }
  const parts = token.split('.');
  if (
    parts.length !== 4 ||
    parts[0] !== TOKEN_VERSION ||
    !/^[0-9a-z]{1,12}$/.test(parts[1]) ||
    !HEX_48.test(parts[2]) ||
    !HEX_64.test(parts[3])
  ) return null;
  const issuedAt = parseInt(parts[1], 36);
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt.toString(36) !== parts[1] ||
    issuedAt > now ||
    now - issuedAt > TOKEN_MAX_AGE_MS
  ) return null;

  const payload = parts.slice(0, 3).join('.');
  const provided = Buffer.from(parts[3], 'hex');
  const expected = Buffer.from(
    keyedHash(secret, 'cookie:' + contestKey, payload),
    'hex'
  );
  if (!timingSafeEqual(provided, expected)) return null;
  return {
    guestHash: keyedHash(secret, 'identity:' + contestKey, parts[2]),
    issuedAt
  };
}

export function readContestGuestCookie(header) {
  if (typeof header !== 'string' || header.length > 8192) return null;
  const found = header
    .split(';')
    .map(part => part.trim())
    .filter(part => part.startsWith(CONTEST_GUEST_COOKIE + '='));
  // Duplicate cookie names may indicate cookie-tossing; fail closed.
  if (found.length !== 1) return null;
  return found[0].slice(CONTEST_GUEST_COOKIE.length + 1) || null;
}

/**
 * Explicit origin allowlist; do not derive the allowlist from client-controlled
 * Host or X-Forwarded-Host headers.
 */
export function contestGuestOriginAllowed(headers, allowedOrigins) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    return false;
  }
  const origin = String(headers?.origin ?? '');
  const fetchSite = String(headers?.['sec-fetch-site'] ?? '');
  if (fetchSite && fetchSite !== 'same-origin') return false;
  try {
    const url = new URL(origin);
    if (url.username || url.password || url.pathname !== '/' ||
        url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) {
      return false;
    }
    return allowedOrigins.includes(url.origin);
  } catch {
    return false;
  }
}

function canonicalIpv6(ip) {
  const lower = ip.toLowerCase();
  const sides = lower.split('::');
  if (sides.length > 2) return null;
  const left = sides[0] ? sides[0].split(':') : [];
  const right = sides[1] ? sides[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (sides.length === 1 && missing !== 0)) return null;
  const parts = [...left, ...Array(missing).fill('0'), ...right];
  if (parts.length !== 8 || parts.some(p => !/^[0-9a-f]{1,4}$/.test(p))) {
    return null;
  }
  return parts.map(part => parseInt(part, 16).toString(16));
}

/**
 * Coarse, keyed network evidence for aggregate abuse review only.
 * Never use network equality alone as proof of the same person.
 * Never persist a raw IP address or user-agent through this helper.
 */
export function pseudonymizeGuestNetwork({ ip, userAgent, secret, contestKey }) {
  checkSecret(secret);
  checkContestKey(contestKey);
  let prefix = null;
  const address = String(ip ?? '').trim().replace(/^\[|\]$/g, '');
  const version = isIP(address);
  if (version === 4) {
    prefix = '4:' + address.split('.').slice(0, 3).join('.');
  } else if (version === 6) {
    const groups = canonicalIpv6(address);
    if (groups) prefix = '6:' + groups.slice(0, 4).join(':');
  }
  const agent = String(userAgent ?? '').trim().slice(0, 512);
  return {
    networkHash: prefix
      ? keyedHash(secret, 'network:' + contestKey, prefix)
      : null,
    agentHash: agent
      ? keyedHash(secret, 'agent:' + contestKey, agent)
      : null
  };
}

/**
 * Advance a read using ONLY server timestamps/state. Caller MUST load/store
 * the state atomically, and must validate published episode and enrolled novel.
 * Client progress and interactions are hints, not proof of actual comprehension.
 */
export function advanceContestGuestRead({
  previous,
  payload,
  serverNow,
  rule
}) {
  if (
    !previous || !payload || !rule ||
    !Number.isSafeInteger(serverNow) ||
    !Number.isSafeInteger(previous.lastSeenAt) ||
    !Number.isSafeInteger(previous.startedAt) ||
    !Number.isInteger(previous.lastSeq) ||
    !Number.isFinite(previous.foregroundMs) ||
    !Number.isFinite(previous.maxProgress) ||
    !Number.isInteger(payload.seq) ||
    payload.seq <= previous.lastSeq ||
    payload.seq - previous.lastSeq > rule.maxSequenceJump ||
    typeof payload.visible !== 'boolean' ||
    typeof payload.progress !== 'number' ||
    payload.progress < 0 || payload.progress > 1 ||
    !Number.isFinite(payload.progress) ||
    !Number.isFinite(rule.maxHeartbeatCreditMs) ||
    !Number.isFinite(rule.minForegroundMs) ||
    !Number.isFinite(rule.minProgress) ||
    !Number.isSafeInteger(rule.maxSequenceJump) ||
    rule.maxSequenceJump < 1 ||
    rule.maxHeartbeatCreditMs <= 0 ||
    rule.minForegroundMs <= 0 ||
    rule.minProgress <= 0 || rule.minProgress > 1 ||
    serverNow < previous.lastSeenAt ||
    previous.lastSeenAt < previous.startedAt
  ) {
    return { accepted: false, reason: 'invalid_progress' };
  }
  const elapsed = serverNow - previous.lastSeenAt;
  const credited = payload.visible
    ? Math.max(0, Math.min(elapsed, rule.maxHeartbeatCreditMs))
    : 0;
  const next = {
    ...previous,
    lastSeenAt: serverNow,
    lastSeq: payload.seq,
    foregroundMs: previous.foregroundMs + credited,
    maxProgress: Math.max(previous.maxProgress, payload.progress)
  };
  const qualified =
    next.foregroundMs >= rule.minForegroundMs &&
    next.maxProgress >= rule.minProgress;
  return { accepted: true, next, qualified, newlyQualified: qualified && !previous.qualified };
}

/**
 * Qualifying episodes are DISTINCT episode IDs, from a verified and
 * non-quarantined ledger. Updating 1->3->5 points is NOT additive.
 */
export function contestReaderPoints(distinctQualifiedEpisodeCount) {
  if (!Number.isSafeInteger(distinctQualifiedEpisodeCount) ||
      distinctQualifiedEpisodeCount < 0) {
    throw new Error('Invalid distinct episode count');
  }
  if (distinctQualifiedEpisodeCount >= 10) return 5;
  if (distinctQualifiedEpisodeCount >= 5) return 3;
  if (distinctQualifiedEpisodeCount >= 3) return 1;
  return 0;
}

/**
 * Risk signals are derived by trusted server-side checks, never taken from
 * browser input. Missing evidence and suspicious clusters require review.
 * Do not publicly publish internal signal weights or private review findings.
 */
export function contestGuestPayoutDisposition({
  verifiedSession,
  readEvidenceValid,
  suspectedAutomation,
  suspectedSybil,
  overlapWithAuthenticatedUser,
  confirmedAbuse
}) {
  if (confirmedAbuse) return 'exclude';
  if (!verifiedSession || !readEvidenceValid) return 'not_qualified';
  if (suspectedAutomation || suspectedSybil || overlapWithAuthenticatedUser) {
    return 'review_hold';
  }
  return 'provisional';
}
