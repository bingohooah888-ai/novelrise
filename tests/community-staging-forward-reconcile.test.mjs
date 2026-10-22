import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  composeCommunityStagingForwardReconcile
} from '../scripts/community-staging-forward-reconcile.mjs';

const migration = readFileSync(
  'supabase/migrations/20261014052000_community_plaza_phase1.sql',
  'utf8'
);
const compose = composeCommunityStagingForwardReconcile;
function denied(sql, pattern) {
  assert.throws(() => compose(sql), pattern);
}

test('compose guarded forward-only Staging SQL', () => {
  const sql = compose(migration);
  assert.match(sql, /^\\set ON_ERROR_STOP on$/m);
  assert.match(sql, /ADD COLUMN edited_at timestamptz/);
  assert.match(sql, /Refusing different migration history/);
  assert.match(sql, /Existing community content or consent; stop/);
  assert.match(sql, /Public gate changed during reconciliation/);
  assert.match(sql, /Required community RPC missing after replay/);
  assert.match(sql, /novelight_community_report_comment/);
  assert.match(sql, /novelight_admin_community_dismiss_report/);
  assert.match(sql, /ALTER TABLE public.community_runtime_control/);
  assert.equal(sql.match(/^BEGIN;$/gm)?.length, 1);
  assert.equal(sql.match(/^COMMIT;$/gm)?.length, 1);
  assert.doesNotMatch(sql, /INSERT INTO supabase_migrations/iu);
  assert.doesNotMatch(sql, /UPDATE supabase_migrations/iu);
  assert.doesNotMatch(sql, /DELETE FROM supabase_migrations/iu);
});

test('reject malformed or unreviewed candidate SQL wrappers', () => {
  denied('', /invalid canonical candidate migration/u);
  const noBegin = migration.replace(/^BEGIN;$/m, '-- missing BEGIN');
  denied(noBegin, /wrapper\/version mismatch/u);
  const wrongEnd = migration.replace(/^COMMIT;$/m, 'ROLLBACK;');
  denied(wrongEnd, /wrapper\/version mismatch/u);
  const duplicateCommit = migration.replace(/^COMMIT;$/m, 'COMMIT;\nCOMMIT;');
  denied(duplicateCommit, /wrapper\/version mismatch/u);
});

test('reject hidden ledger edits and psql metacommands', () => {
  const mutation = migration.replace(
    /^COMMIT;$/m,
    'UPDATE supabase_migrations.schema_migrations SET name=name;\nCOMMIT;'
  );
  denied(mutation, /ledger modification/u);
  const metacommand = migration.replace(
    /^COMMIT;$/m,
    '\\i /tmp/unknown.sql\nCOMMIT;'
  );
  denied(metacommand, /meta-command/u);
});
