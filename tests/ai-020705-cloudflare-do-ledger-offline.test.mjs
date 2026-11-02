import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
// prettier-ignore
import { create020705CloudflareDoLedgerOffline } from
  '../.github/staging-ai-02-07-05/cloudflare-do-ledger-offline.mjs';

const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const ARM = 'NOVELIGHT_AI_020705_WATCHDOG_ONE_USE_V1';
const RECOVERY = 'NOVELIGHT_AI_020705_RECOVERY_ONE_USE_V1';
const NOW = Date.parse('2026-11-02T00:00:00Z');
// prettier-ignore
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: STAGING,
  mainSha: 'a'.repeat(40), previewDeploymentId: 'dpl_synthetic123',
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 41, episodeId: 11, runId: 1001, approvalCommentId: 777
});

// prettier-ignore
function harness() {
  const db = new DatabaseSync(':memory:');
  let inTransaction = false;
  const storage = {
    sql: {
      exec(query, ...params) {
        const stmt = db.prepare(query);
        const result = /^\s*(?:SELECT|WITH|PRAGMA)\b/iu.test(query)
          ? stmt.all(...params) : (stmt.run(...params), []);
        return {toArray: () => result};
      }
    },
    transactionSync(fn) {
      if (inTransaction) throw new Error('unexpected nested transaction');
      inTransaction = true;
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        inTransaction = false;
      }
    }
  };
  const ledger = () => create020705CloudflareDoLedgerOffline({
    mode: 'offline-synthetic-only', storage, now: () => NOW
  });
  return {db, storage, ledger};
}
// prettier-ignore
const arm = () => ({scope, contract: ARM,
  controllerKeyId: 'synthetic-controller-key', nonce: 'A'.repeat(44)});
// prettier-ignore
const recovery = (nonce) => ({scope, contract: RECOVERY, nonce,
  checkedSignedDeathOffline: true, observedPaidTombstoneOffline: true});

// prettier-ignore
test('one synthetic arm claim wins even if 32 logical controllers race', async () => {
  const h = harness();
  try {
    const workerA = h.ledger();
    workerA.initialize();
    const logicalControllers = Array.from({length: 32}, () => h.ledger());
    const results = await Promise.all(logicalControllers.map((x) =>
      Promise.resolve().then(() => x.consumeSyntheticArmOnce(arm()))));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(results.filter((x) => !x).length, 31);
    assert.equal(h.ledger().consumeSyntheticArmOnce(arm()), false);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM gatea_arm_spent').get().n, 1);
  } finally { h.db.close(); }
});

// prettier-ignore
test('lease round is fenced and never authorizes a paid POST or mutation', () => {
  const h = harness();
  try {
    const ledger = h.ledger(); ledger.initialize();
    const first = ledger.beginSyntheticRecovery(recovery('B'.repeat(44)));
    assert.equal(first.round, 1);
    assert.equal(first.fence, 1);
    assert.equal(first.authorizesPaidCall, false);
    assert.equal(first.authorizesMutation, false);
    assert.equal(ledger.beginSyntheticRecovery(recovery('C'.repeat(44))), null);
    assert.equal(ledger.settleSyntheticRecovery({scope, round: 1, fence: 999,
      nonce: 'B'.repeat(44), state: 'failed'}), false);
    assert.equal(ledger.settleSyntheticRecovery({scope, round: 1, fence: 1,
      nonce: 'B'.repeat(44), state: 'failed'}), true);
    assert.equal(ledger.settleSyntheticRecovery({scope, round: 1, fence: 1,
      nonce: 'B'.repeat(44), state: 'failed'}), false);
    const second = ledger.beginSyntheticRecovery(recovery('C'.repeat(44)));
    assert.equal(second.round, 2);
    assert.equal(second.fence, 2);
    assert.equal(ledger.beginSyntheticRecovery(recovery('B'.repeat(44))), null);
    assert.equal(ledger.settleSyntheticRecovery({scope, round: 2, fence: 2,
      nonce: 'C'.repeat(44), state: 'failed'}), true);
    const third = ledger.beginSyntheticRecovery(recovery('D'.repeat(44)));
    assert.equal(third.round, 3);
    assert.equal(third.fence, 3);
    assert.equal(ledger.settleSyntheticRecovery({scope, round: 3, fence: 3,
      nonce: 'D'.repeat(44), state: 'failed'}), true);
    assert.equal(ledger.beginSyntheticRecovery(recovery('E'.repeat(44))), null);
  } finally { h.db.close(); }
});

// prettier-ignore
test('completed recovery and invalid scope never reopen or affect other scopes', () => {
  const h = harness();
  try {
    const ledger = h.ledger(); ledger.initialize();
    const first = ledger.beginSyntheticRecovery(recovery('F'.repeat(44)));
    assert.equal(first.round, 1);
    assert.equal(ledger.settleSyntheticRecovery({scope, round: 1,
      fence: first.fence, nonce: 'F'.repeat(44), state: 'complete'}), true);
    assert.equal(ledger.beginSyntheticRecovery(recovery('G'.repeat(44))), null);
    assert.throws(() => ledger.beginSyntheticRecovery({
      ...recovery('H'.repeat(44)),
      scope: {...scope, stagingProjectRef: 'fiepaguycecrredwrcwx'}
    }), /AI_020705_CLOUDFLARE_LEDGER_OFFLINE_DENIED/u);
    const other = {...scope, novelId: 42};
    const independent = ledger.beginSyntheticRecovery({
      ...recovery('I'.repeat(44)), scope: other
    });
    assert.equal(independent.round, 1);
  } finally { h.db.close(); }
});

// prettier-ignore
test('no trusted proof or paid tombstone, unapproved mode, invalid nonce denies', () => {
  const h = harness();
  try {
    const ledger = h.ledger(); ledger.initialize();
    const invalid = [
      {...recovery('J'.repeat(44)), checkedSignedDeathOffline: false},
      {...recovery('K'.repeat(44)), observedPaidTombstoneOffline: false},
      {...recovery('L'.repeat(44)), nonce: 'short'},
      {...recovery('M'.repeat(44)), scope: {...scope, mainSha: 'wrong'}}
    ];
    for (const input of invalid) assert.throws(
      () => ledger.beginSyntheticRecovery(input),
      /AI_020705_CLOUDFLARE_LEDGER_OFFLINE_DENIED/u);
    assert.throws(() => create020705CloudflareDoLedgerOffline({
      mode: 'staging-live', storage: h.storage
    }), /AI_020705_CLOUDFLARE_LEDGER_OFFLINE_DENIED/u);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM gatea_recovery_rounds').get().n, 0);
  } finally { h.db.close(); }
});
