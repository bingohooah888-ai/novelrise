import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  FORMAL_MAINTENANCE_PENDING_PROOFS,
  FORMAL_MAINTENANCE_SAFETY_APPROVED,
  PROPOSED_SCOUT_LOCK_PREFIX,
  inspectFormalMaintenanceDesignEvidence,
  quoteScoutXpLockOrder
} from '../api/_lib/reader-reward/formal-maintenance-release-gate.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const design = readFileSync(
  new URL(
    '../docs/drafts/SCOUT_FORMAL_30DAY_SAFETY_CONTRACT_20261114.md',
    import.meta.url
  ),
  'utf8'
);

test('runtime is blocked even with a fully synthetic positive checklist', () => {
  assert.equal(FORMAL_MAINTENANCE_SAFETY_APPROVED, false);
  const fake = Object.fromEntries(
    FORMAL_MAINTENANCE_PENDING_PROOFS.map((name) => [name, true])
  );
  assert.equal(
    inspectFormalMaintenanceDesignEvidence(fake).executionAllowed,
    false
  );
});

test('missing required proof is explicit, immutable and fail-closed', () => {
  const result = inspectFormalMaintenanceDesignEvidence();
  assert.equal(result.missing.length, 11);
  assert.equal(result.executionAllowed, false);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.missing));
});

test('all-true evidence remains just a design checklist', () => {
  const fake = Object.fromEntries(
    FORMAL_MAINTENANCE_PENDING_PROOFS.map((name) => [name, true])
  );
  const result = inspectFormalMaintenanceDesignEvidence(fake);
  assert.deepEqual(result.missing, []);
  assert.equal(
    result.status,
    'requires_separate_database_proof_and_owner_approval'
  );
});

test('forged truthy strings and malformed evidence never satisfy proof', () => {
  for (const input of [
    null,
    [],
    false,
    'true',
    { allXpInsertUpdateDeleteWritersSerialized: 'true' }
  ]) {
    assert.equal(
      inspectFormalMaintenanceDesignEvidence(input).missing.length,
      11
    );
  }
});

test('lock keys are stable, canonical and independent of event category', () => {
  const key = quoteScoutXpLockOrder([A]);
  assert.equal(key[0], PROPOSED_SCOUT_LOCK_PREFIX + A);
  for (const category of ['valid_read', 'light_seed', 'discovery', 'comment']) {
    assert.ok(category);
    assert.deepEqual(quoteScoutXpLockOrder([A]), key);
  }
});

test('cross-reader UPDATE locks both IDs in sorted order', () => {
  assert.deepEqual(
    quoteScoutXpLockOrder([B, A, B]),
    quoteScoutXpLockOrder([A, B])
  );
  assert.equal(quoteScoutXpLockOrder([A, B]).length, 2);
});

test('case-insensitive UUID normalization cannot create distinct locks', () => {
  assert.deepEqual(
    quoteScoutXpLockOrder(['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA']),
    quoteScoutXpLockOrder(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
  );
});

test('malformed readers and unsupported large batches fail closed', () => {
  for (const input of [
    [],
    null,
    'text',
    Array(26).fill(A),
    [A, 'bad'],
    [undefined]
  ]) {
    assert.throws(() => quoteScoutXpLockOrder(input));
  }
});

test('non-executable SQL design includes all three XP ledger mutations', () => {
  for (const section of [
    'DO NOT APPLY',
    'INSERT',
    'UPDATE',
    'DELETE',
    'deterministic'
  ]) {
    assert.ok(design.includes(section), section);
  }
});

test('design requires a shared transaction lock and fresh committed snapshot', () => {
  for (const term of [
    'pg_advisory_xact_lock',
    'hashtextextended',
    'READ COMMITTED',
    'FOR UPDATE',
    'fresh snapshot'
  ]) {
    assert.ok(design.includes(term), term);
  }
});

test('seal, late-XP corrections and compensation remain blocked', () => {
  for (const term of [
    'seal',
    'HELD',
    'correction',
    'compensation',
    'fail-closed'
  ]) {
    assert.ok(design.includes(term), term);
  }
});

test('beta cap, discovery XP and rollback are explicit release blockers', () => {
  for (const term of [
    'novelight_cap_scout_xp_beta',
    'light_seed_discovery',
    'rollback'
  ]) {
    assert.ok(design.includes(term), term);
  }
});

test('due-RPC is private, bounded and does not grant direct table SELECT', () => {
  for (const term of [
    'list_due_scout_30_day_reviews',
    'SECURITY DEFINER',
    'search_path',
    '25',
    'No GRANT SELECT'
  ]) {
    assert.ok(design.includes(term), term);
  }
});

test('contract is Markdown-only, not a runnable SQL migration', () => {
  assert.match(design, /Markdown-only/);
  assert.doesNotMatch(design, /^CREATE\s+FUNCTION/im);
});

test('due-user selection never uses private table SELECT', () => {
  const runnerSource = readFileSync(
    new URL(
      '../api/_lib/reader-reward/formal-maintenance-runner.js',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(runnerSource, /list_due_scout_30_day_reviews/);
  assert.doesNotMatch(
    runnerSource,
    /select user_id from novelight_formal_private\.scout_level_state/
  );
  assert.doesNotMatch(runnerSource, /has_table_privilege/);
});

test('no code path in Runner targets legacy unsealed review RPC', () => {
  const runnerSource = readFileSync(
    new URL(
      '../api/_lib/reader-reward/formal-maintenance-runner.js',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(runnerSource, /review_scout_30_days_sealed/);
  assert.doesNotMatch(
    runnerSource,
    /select novelight_formal_private\.review_scout_30_days\(/
  );
  assert.match(runnerSource, /FORMAL_MAINTENANCE_SAFETY_APPROVED === true/);
});

test('absent sealed DB proof keeps rollout blocked', () => {
  assert.equal(FORMAL_MAINTENANCE_SAFETY_APPROVED, false);
  assert.match(design, /review_scout_30_days_sealed/);
  assert.match(design, /list_due_scout_30_day_reviews/);
  assert.match(design, /source finality/);
});


const stagingSqlCandidate = readFileSync(
  new URL(
    '../docs/drafts/SCOUT_FORMAL_30DAY_STAGING_SAFE_SQL_20261114.sql',
    import.meta.url
  ),
  'utf8'
);

test('fail-closed XP lock covers mutations', () => {
  const sql = stagingSqlCandidate;
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(
    sql,
    /BEFORE INSERT OR UPDATE OR DELETE ON public\.scout_xp_ledger/
  );
  assert.match(sql, /novelight:scout-formal-xp-review:v1:/);
  assert.match(sql, /ORDER BY id::text/);
});

test('review holds until finality and cutover', () => {
  const sql = stagingSqlCandidate;
  assert.match(sql, /CHECK \(enabled = false\)/);
  assert.match(sql, /source_evidence_verified/);
  assert.match(sql, /source_watermark_at >= v_end/);
  assert.match(sql, /beta_cutover_pending/);
  assert.match(sql, /window_unsealed/);
  assert.match(sql, /late_xp_pending/);
  assert.match(sql, /adjustment_policy_pending/);
  assert.doesNotMatch(
    sql,
    /PERFORM\s+novelight_formal_private\.review_scout_30_days\(/
  );
});

test('private RPCs avoid direct table SELECT', () => {
  const sql = stagingSqlCandidate;
  assert.match(sql, /list_due_scout_30_day_reviews/);
  assert.match(sql, /review_scout_30_days_sealed/);
  assert.match(sql, /SECURITY DEFINER SET search_path = ''/);
  assert.match(sql, /REVOKE ALL ON FUNCTION/);
  assert.match(sql, /TO service_role/);
  assert.doesNotMatch(sql, /^GRANT SELECT ON /mi);
});

test('beta cutover remains unapproved', () => {
  const sql = stagingSqlCandidate;
  assert.match(sql, /NOT A MIGRATION/);
  assert.match(sql, /DO NOT APPLY/);
  assert.match(
    sql,
    /beta cap, discovery awarding, and legacy RPC are NOT replaced/
  );
  assert.doesNotMatch(sql, /^\s*COMMIT\s*;/mi);
  assert.equal(FORMAL_MAINTENANCE_SAFETY_APPROVED, false);
});
