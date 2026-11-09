// Phase 2, offline-only session evidence contract for owner-outline-internal-adapter.
// UNMOUNTED: no API route imports this module and there are no built-in DB,
// Auth network calls, token parsing, service keys, or session mutations.
// A future server caller MUST provide a signature-/issuer-/audience-verifying
// Supabase auth.getClaims(jwt) adapter and an authorized server-side lookup
// of auth.sessions by signed session_id. Do NOT expose auth.sessions in a public
// Data API, accept client-supplied "verified" claims, or decode JWTs as proof.
//
// A deleted auth.sessions row is evidence of server-side sign-out. This
// contract cannot observe browser-only logout, failed sign-out, time-box
// settings, or a revocation that happens after the last read. No real-world
// revocation guarantee is claimed until the privileged observer is implemented
// and separately proven with real auth in an authorized environment.
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value) {
  return typeof value === 'string' && UUID.test(value)
    ? value.toLowerCase()
    : null;
}

function novelId(value) {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))
  ) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Pure, deterministic decision from two *server-supplied and separately
// authenticated* observations. No IO and no credentials.
export function evaluateOwnerSessionEvidence({
  actorId,
  claims,
  sessionRow,
  epochSeconds
} = {}) {
  const actor = uuid(actorId);
  const subject = uuid(claims?.sub);
  const signedSession = uuid(claims?.session_id);
  const rowSession = uuid(sessionRow?.id);
  const rowOwner = uuid(sessionRow?.user_id);
  const exp = claims?.exp;
  const issued = claims?.iat;
  const notBefore = claims?.nbf;

  if (
    !actor ||
    !subject ||
    !signedSession ||
    !rowSession ||
    !rowOwner ||
    actor !== subject ||
    actor !== rowOwner ||
    signedSession !== rowSession ||
    claims.role !== 'authenticated' ||
    claims.aud !== 'authenticated' ||
    claims.is_anonymous === true ||
    !Number.isSafeInteger(epochSeconds) ||
    epochSeconds <= 0 ||
    !Number.isSafeInteger(exp) ||
    exp <= epochSeconds ||
    !Number.isSafeInteger(issued) ||
    issued > epochSeconds ||
    (notBefore !== undefined &&
      (!Number.isSafeInteger(notBefore) || notBefore > epochSeconds))
  ) return null;

  // Session UUID, never a JWT/refresh token; remains server-internal.
  return Object.freeze({ active: true, binding: signedSession });
}

// Dependency-injected "checkSession" for future *server-only* use.
// Each dependency must be a trusted server-side capability, not a request
// parameter. verifySignedClaims MUST cryptographically verify the JWT; the
// method name alone does not make a decoded JWT trustworthy.
// readExistingSession MUST query auth.sessions using a privileged, scoped
// server-only channel; an ordinary Supabase Data API request cannot do this.
// nowEpochSeconds MUST use a trusted server clock.
// This factory performs no actual Auth, DB, network, or token storage.
export function createOfflineOwnerSessionCheck({
  verifySignedClaims,
  readExistingSession,
  nowEpochSeconds
} = {}) {
  const ready =
    typeof verifySignedClaims === 'function' &&
    typeof readExistingSession === 'function' &&
    typeof nowEpochSeconds === 'function';

  return async function checkSession({ bearerToken, actorId, novelId: work } = {}) {
    const actor = uuid(actorId);
    const workId = novelId(work);
    if (
      !ready ||
      !actor ||
      !workId ||
      typeof bearerToken !== 'string' ||
      bearerToken.length < 16 ||
      bearerToken.length > 4096 ||
      /\s/.test(bearerToken)
    ) return null;

    try {
      // Match the existing Supabase getClaims() output contract. The injected
      // verifier must enforce signature, issuer, and audience.
      const verified = await verifySignedClaims(bearerToken);
      if (verified?.error || !verified?.data?.claims) return null;

      const claims = verified.data.claims;
      const sessionId = uuid(claims?.session_id);
      const subject = uuid(claims?.sub);
      const now = nowEpochSeconds();
      if (
        !sessionId ||
        subject !== actor ||
        !Number.isSafeInteger(now) ||
        now <= 0 ||
        !Number.isSafeInteger(claims?.exp) ||
        claims.exp <= now
      ) return null;

      const lookup = await readExistingSession({ sessionId, actorId: actor });
      if (lookup?.error || !lookup?.data) return null;

      return evaluateOwnerSessionEvidence({
        actorId: actor,
        claims,
        sessionRow: lookup.data,
        epochSeconds: nowEpochSeconds()
      });
    } catch {
      // Missing session, uncertain verification, lookup failure and logout
      // all fail closed; do not log sensitive JWTs or private session rows.
      return null;
    }
  };
}
