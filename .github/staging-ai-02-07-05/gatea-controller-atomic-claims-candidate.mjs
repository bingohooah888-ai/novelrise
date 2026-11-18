// CODE ONLY. Scoped, single-winner claim helper for the EXISTING SQLite DO.
// Must run in the SAME owner-approved Durable Object instance for every
// contender. Never use a per-process Map, a second namespace, or a caller
// selected DO ID as a real recovery ledger. No D1 or migration is created.

const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KINDS = ['ARM', 'ARM_RECEIPT', 'RECOVERY'];
const positive = (v) => Number.isSafeInteger(v) && v > 0;
function validScope(s) {
  return s?.repository === REPO && s?.stagingProjectRef === STAGING &&
    SHA.test(s.mainSha ?? '') &&
    /^dpl_[A-Za-z0-9]+$/u.test(s.previewDeploymentId ?? '') &&
    UUID.test(s.actorId ?? '') &&
    ['novelId', 'episodeId', 'runId', 'approvalCommentId']
      .every((k) => positive(s[k]));
}

/**
 * Persistent one-use records. Claim keys intentionally omit nonce,
 * candidate SHA and Controller ID so rotating them cannot replay a run.
 * A new runId + OWNER approval is mandatory for a new authorized attempt.
 * This is not an independent audit of STOP or an authority to call paid AI.
 */
export function create020705DurableAtomicClaimsCandidate({
  storage, scope, controllerRunId, verifyDurableState
} = {}) {
  if (!validScope(scope) || !positive(controllerRunId) ||
      controllerRunId === scope.runId ||
      typeof storage?.transactionSync !== 'function' ||
      typeof storage?.sql?.exec !== 'function') {
    throw new Error('AI_020705_ATOMIC_CLAIM_NO_GO');
  }
  const key = JSON.stringify([
    REPO, STAGING, scope.runId, scope.approvalCommentId
  ]);
  return Object.freeze({
    claimOnce({ kind, scope: incoming, nonce, controllerRunId: caller } = {}) {
      if (!KINDS.includes(kind) || !NONCE.test(nonce ?? '') ||
          caller !== controllerRunId || !validScope(incoming) ||
          incoming.runId !== scope.runId ||
          incoming.approvalCommentId !== scope.approvalCommentId ||
          incoming.mainSha !== scope.mainSha ||
          incoming.previewDeploymentId !== scope.previewDeploymentId ||
          incoming.actorId !== scope.actorId ||
          incoming.novelId !== scope.novelId ||
          incoming.episodeId !== scope.episodeId) return false;
      try {
        return storage.transactionSync(() => {
          // The Watchdog checks its stored row INSIDE this transaction.
          if (verifyDurableState !== undefined &&
              (typeof verifyDurableState !== 'function' ||
               verifyDurableState({ kind, scope: incoming, nonce,
                 controllerRunId }) !== true)) return false;
          storage.sql.exec(
            'CREATE TABLE IF NOT EXISTS gatea_atomic_claims_v1 (' +
            ' claim_kind TEXT NOT NULL, run_key TEXT NOT NULL,' +
            ' challenge_nonce TEXT NOT NULL, controller_run_id INTEGER NOT NULL,' +
            ' PRIMARY KEY(claim_kind,run_key))'
          );
          const cursor = storage.sql.exec(
            'INSERT OR IGNORE INTO gatea_atomic_claims_v1 ' +
            '(claim_kind,run_key,challenge_nonce,controller_run_id)' +
            ' VALUES(?,?,?,?)', kind, key, nonce, controllerRunId
          );
          return cursor?.rowsWritten === 1;
        }) === true;
      } catch { return false; }
    }
  });
}
