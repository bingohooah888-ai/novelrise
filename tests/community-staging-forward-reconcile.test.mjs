import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as reconcile from '../scripts/community-staging-forward-reconcile.mjs';

const path = 'supabase/migrations/20261014052000_community_plaza_phase1.sql';
const canonical = readFileSync(path, 'utf8');
const compose = reconcile.composeCommunityStagingForwardReconcile;

test('guarded forward SQL has one transaction and no ledger writes', () => {
  const sql = compose(canonical);
  assert.match(sql, /ADD COLUMN edited_at/);
  assert.match(sql, /Refusing different migration history/);
  assert.match(sql, /Existing community content or consent/);
  assert.match(sql, /Public gate changed during reconciliation/);
  assert.match(sql, /Required community RPC missing/);
  assert.match(sql, /novelight_admin_community_dismiss_report/);
  assert.equal(sql.match(/^BEGIN;$/gm)?.length, 1);
  assert.equal(sql.match(/^COMMIT;$/gm)?.length, 1);
  assert.doesNotMatch(sql, /INSERT INTO supabase_migrations/iu);
  assert.doesNotMatch(sql, /UPDATE supabase_migrations/iu);
  assert.doesNotMatch(sql, /DELETE FROM supabase_migrations/iu);
});

test('malformed migration transaction wrappers are rejected', () => {
  const badStart = canonical.replace(/^BEGIN;$/m, '');
  const badEnd = canonical.replace(/^COMMIT;$/m, 'ROLLBACK;');
  const doubled = canonical.replace(/^COMMIT;$/m, 'COMMIT;\nCOMMIT;');
  assert.throws(() => compose(badStart), /wrapper\/version mismatch/u);
  assert.throws(() => compose(badEnd), /wrapper\/version mismatch/u);
  assert.throws(() => compose(doubled), /wrapper\/version mismatch/u);
});

test('ledger writes and psql includes are rejected', () => {
  const mutation = canonical.replace(
    /^COMMIT;$/m,
    'UPDATE supabase_migrations.schema_migrations SET name=name;\nCOMMIT;'
  );
  const include = canonical.replace(/^COMMIT;$/m, '\\i unknown.sql\nCOMMIT;');
  assert.throws(() => compose(mutation), /ledger modification/u);
  assert.throws(() => compose(include), /meta-command/u);
});
