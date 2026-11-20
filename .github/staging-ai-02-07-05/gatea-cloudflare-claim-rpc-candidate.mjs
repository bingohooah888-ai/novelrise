// CODE ONLY: gatea_live_once admission is checked in the same existing
// Cloudflare SQLite Durable Object transaction as the recovery replay claim.
// No new DO, migration, HTTP route, token, or privileged call on import.
import { create020705DurableAtomicClaimsCandidate } from './gatea-controller-atomic-claims-candidate.mjs';

const FIELDS = [
  'repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
  'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'
];
const KINDS = ['ARM', 'ARM_RECEIPT', 'RECOVERY'];
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const positive = (x) => Number.isSafeInteger(x) && x > 0;
function deny() { throw new Error('AI_020705_CLOUDFLARE_CLAIM_RPC_NO_GO'); }

/**
 * Called ONLY by the existing Watchdog DO class through private authenticated fetch.
 * Privileged Controller Worker must use an internal cross-Worker DO binding.
 * A public HTTP request cannot invoke this exported function.
 */
export function claim020705WithinExistingWatchdog({
  storage, env, readCurrent, input
} = {}) {
  const { kind, scope, nonce, controllerRunId } = input ?? {};
  if (!KINDS.includes(kind) ||
      env?.GATEA_LOCAL_SYNTHETIC_ONLY === 'true' ||
      env?.GATEA_LIVE_ENABLED !== 'true' ||
      env?.GATEA_RECOVERY_DISPATCH_ENABLED !== 'true' ||
      env?.GATEA_CLAIM_LEDGER_ENABLED !== 'true' ||
      !scope || typeof scope !== 'object' || Array.isArray(scope) ||
      Object.keys(scope).length !== FIELDS.length ||
      !FIELDS.every((k) => Object.hasOwn(scope, k)) ||
      !NONCE.test(nonce ?? '') || !positive(controllerRunId) ||
      typeof readCurrent !== 'function') deny();
  const ledger = create020705DurableAtomicClaimsCandidate({
    storage, scope, controllerRunId,
    verifyDurableState({ kind: requestedKind }) {
      const row = readCurrent();
      if (!row || row.nonce !== nonce ||
          row.controller_run_id !== controllerRunId ||
          row.scope !== JSON.stringify(FIELDS.map((key) => scope[key])) ||
          row.state !== (requestedKind === 'RECOVERY' ? 'CLAIMED' : 'WATCHING')) {
        return false;
      }
      if (requestedKind === 'RECOVERY') {
        let receipt;
        try { receipt = JSON.parse(row.receipt); } catch { return false; }
        if (receipt?.domain !== 'NOVELIGHT_AI_020705_DETACHED_DEATH_V1' ||
            receipt?.challengeNonce !== nonce ||
            receipt?.proof?.controllerRunId !== controllerRunId ||
            receipt.proof.runId !== scope.runId ||
            !FIELDS.every((k) => receipt.proof[k] === scope[k])) return false;
      }
      return true;
    }
  });
  if (!ledger.claimOnce({ kind, scope, nonce, controllerRunId })) deny();
  return Object.freeze({
    claimed: true, kind, runId: scope.runId,
    approvalCommentId: scope.approvalCommentId, controllerRunId
  });
}
