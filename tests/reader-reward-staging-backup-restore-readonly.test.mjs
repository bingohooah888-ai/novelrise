import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseStagingConnection, fingerprintSql } from '../scripts/reader-reward-staging-backup-restore-readonly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(resolve(root,'.github/workflows/scout-point10x-staging-identity-readonly.yml'), 'utf8');
const approvedOriginalSha256 = '8d35c2b09e92e1c283e1756cdc3dc13b01601a8cf8fa809f3a959e2382ed99a1';

test('original Point10x job remains byte-identical; only a separate review job is appended', () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s{2}(schedule|push|issue_comment|pull_request|workflow_call):/m);
  const pointJob = workflow.split('  # Separate opt-in path.')[0].replace(
    /      candidate_sha:\n        description: Exact approved Draft candidate commit\n        type: string\n        required: false\n/, ''
  );
  assert.equal(createHash('sha256').update(pointJob.replace(/\n$/, '')).digest('hex'), approvedOriginalSha256);
});

test('dedicated staging only and production and arbitrary pooler hosts fail closed', () => {
  const ref = 'wmlzjgvxgoyrovdhbqbg';
  const valid = `postgresql://postgres.${ref}:encoded%21@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`;
  assert.equal(parseStagingConnection(valid).PGPASSWORD, 'encoded!');
  assert.equal(parseStagingConnection(valid).PGOPTIONS, '-c default_transaction_read_only=on');
  assert.throws(() => parseStagingConnection(valid.replace(':5432', ':6543')));
  assert.throws(() => parseStagingConnection(valid.replace(ref, 'fiepaguycecrredwrcwx')));
  assert.throws(() => parseStagingConnection(valid.replace('aws-0', 'evil-0')));
  assert.throws(() => parseStagingConnection('postgresql://postgres:pw@localhost:5432/postgres'));
  assert.throws(() => parseStagingConnection(''));
});

test('fingerprint covers all accounts and both reward ledgers', () => {
  const sql = fingerprintSql();
  for (const table of ['auth.users','scout_level_state','scout_review_claim',
    'scout_point_usage_wallets','scout_xp_ledger','scout_point_ledger']) {
    assert.ok(sql.includes(table), table);
  }
  assert.match(sql, /sum\(xp_value\)/u);
  assert.match(sql, /sum\(point_value\)/u);
});

test('new review path is disabled unless authorized exactly and never commits Staging', () => {
  const block = workflow.split('  formal-30day-review-backup-restore-only:')[1];
  assert.ok(block);
  for (const required of ['github.run_attempt == 1','github.ref == \'refs/heads/feature/reader-reward-gate01-20261104\'',
    'inputs.candidate_sha == github.sha','inputs.main_sha', 'STAGING_DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}']) {
    assert.ok(block.includes(required),required);
  }
  assert.ok(!/git push|workflow_dispatch:|supabase db push|INSERT INTO|UPDATE\s|DELETE FROM/i.test(block));
});
