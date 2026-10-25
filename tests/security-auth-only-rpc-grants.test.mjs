import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/20261025013000_revoke_anon_trusted_receipt_rpc.sql',
    import.meta.url
  ),
  'utf8'
);

test('trusted allocation receipts do not expose a privileged RPC to anonymous callers', () => {
  assert.match(
    migration,
    /revoke execute on function public\.record_trusted_allocation_receipts\(uuid\[\]\)\s+from anon, public;/i
  );
  assert.match(migration, /has_function_privilege\(\s*'anon'/i);
  assert.match(migration, /raise exception 'Security invariant failed:/i);
});

test('authenticated and service-role callers retain their existing RPC permissions', () => {
  assert.match(migration, /has_function_privilege\(\s*'authenticated'/i);
  assert.match(migration, /has_function_privilege\(\s*'service_role'/i);
  assert.match(migration, /raise exception 'Regression: authenticated/i);
  assert.match(migration, /raise exception 'Regression: service-role/i);
  assert.doesNotMatch(migration, /revoke\s+execute\b[^;]+from\s+authenticated/i);
  assert.doesNotMatch(migration, /drop\s+function/i);
});
