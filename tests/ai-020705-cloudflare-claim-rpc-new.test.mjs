// prettier-ignore
import assert from 'node:assert/strict';
// prettier-ignore
import test from 'node:test';
// prettier-ignore
import { claim020705WithinExistingWatchdog } from '../.github/staging-ai-02-07-05/gatea-cloudflare-claim-rpc-candidate.mjs';

// prettier-ignore
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: 'a'.repeat(40),
  previewDeploymentId: 'dpl_test123',
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 100, episodeId: 200, runId: 300, approvalCommentId: 400
});
// prettier-ignore
const nonce = 'R'.repeat(44);
// prettier-ignore
const flags = Object.freeze({
  GATEA_LIVE_ENABLED: 'true', GATEA_RECOVERY_DISPATCH_ENABLED: 'true',
  GATEA_CLAIM_LEDGER_ENABLED: 'true'
});
// prettier-ignore
const fields = [
  'repository', 'stagingProjectRef', 'mainSha', 'previewDeploymentId',
  'actorId', 'novelId', 'episodeId', 'runId', 'approvalCommentId'
];
// prettier-ignore
function fixture(state = 'WATCHING') {
  const keys = new Set();
  let row = {
    scope: JSON.stringify(fields.map((k) => scope[k])),
    nonce, controller_run_id: 301, state,
    receipt: state === 'CLAIMED' ? JSON.stringify({
      domain: 'NOVELIGHT_AI_020705_DETACHED_DEATH_V1',
      challengeNonce: nonce, proof: { ...scope, controllerRunId: 301 }
    }) : null
  };
  let inTransaction = false;
  const storage = {
    transactionSync: (f) => {
      inTransaction = true;
      try { return f(); } finally { inTransaction = false; }
    },
    sql: {
      exec(sql, kind, key) {
        if (!inTransaction) throw new Error('NOT_ATOMIC');
        if (sql.startsWith('CREATE TABLE')) return { rowsWritten: 0 };
        if (!sql.startsWith('INSERT OR IGNORE')) throw new Error('INVALID_SQL');
        const k = kind + '::' + key;
        if (keys.has(k)) return { rowsWritten: 0 };
        keys.add(k);
        return { rowsWritten: 1 };
      }
    }
  };
  return {
    storage,
    readCurrent: () => {
      assert.equal(inTransaction, true);
      return row;
    },
    changeRow: (next) => { row = { ...row, ...next }; },
    keys
  };
}
// prettier-ignore
test('existing DO permits only one ARM claim from a persisted WATCHING row', () => {
  const f = fixture();
  const args = { storage: f.storage, env: flags, readCurrent: f.readCurrent,
    input: { kind: 'ARM', scope, nonce, controllerRunId: 301 } };
  assert.deepEqual(claim020705WithinExistingWatchdog(args), {
    claimed: true, kind: 'ARM', runId: 300, approvalCommentId: 400,
    controllerRunId: 301
  });
  assert.throws(() => claim020705WithinExistingWatchdog(args),
    /CLOUDFLARE_CLAIM_RPC_NO_GO/u);
  assert.equal(f.keys.size, 1);
});
// prettier-ignore
test('recovery claim requires matching stored signed-death receipt and CLAIMED state', () => {
  const f = fixture('WATCHING');
  const args = { storage: f.storage, env: flags, readCurrent: f.readCurrent,
    input: { kind: 'RECOVERY', scope, nonce, controllerRunId: 301 } };
  assert.throws(() => claim020705WithinExistingWatchdog(args),
    /CLOUDFLARE_CLAIM_RPC_NO_GO/u);
  assert.equal(f.keys.size, 0);
  f.changeRow({ state: 'CLAIMED', receipt: JSON.stringify({
    domain: 'NOVELIGHT_AI_020705_DETACHED_DEATH_V1',
    challengeNonce: nonce,
    proof: { ...scope, controllerRunId: 301 }
  }) });
  assert.equal(claim020705WithinExistingWatchdog(args).claimed, true);
  assert.equal(f.keys.size, 1);
});
// prettier-ignore
test('disabled flags, wrong controller, wrong nonce and forged stored receipt fail closed', () => {
  const f = fixture('CLAIMED');
  const base = { storage: f.storage, env: flags, readCurrent: f.readCurrent,
    input: { kind: 'RECOVERY', scope, nonce, controllerRunId: 301 } };
  for (const other of [
    { env: { ...flags, GATEA_CLAIM_LEDGER_ENABLED: 'false' } },
    { input: { ...base.input, controllerRunId: 302 } },
    { input: { ...base.input, nonce: 'X'.repeat(44) } }
  ]) assert.throws(() => claim020705WithinExistingWatchdog({ ...base, ...other }),
    /CLOUDFLARE_CLAIM_RPC_NO_GO/u);
  f.changeRow({ receipt: JSON.stringify({ domain: 'WRONG', proof: {} }) });
  assert.throws(() => claim020705WithinExistingWatchdog(base),
    /CLOUDFLARE_CLAIM_RPC_NO_GO/u);
  assert.equal(f.keys.size, 0);
});
