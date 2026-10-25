import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationFile = new URL(
  '../supabase/migrations/20261025013000_revoke_anon_trusted_receipt_rpc.sql',
  import.meta.url
);
const migration = readFileSync(migrationFile, 'utf8');

test('trusted receipt RPC denies anonymous EXECUTE', () => {
  assert.match(
    migration,
    /revoke execute on function public\.record_trusted_allocation_receipts\(uuid\[\]\)\s+from anon, public;/i
  );
  assert.match(migration, /has_function_privilege\(\s*'anon'/i);
  assert.match(migration, /raise exception 'Security invariant failed:/i);
});

test('trusted receipt RPC preserves authorized EXECUTE grants', () => {
  assert.match(
    migration,
    /grant execute on function public\.record_trusted_allocation_receipts\(uuid\[\]\)\s+to authenticated, service_role;/i
  );
  assert.match(migration, /has_function_privilege\(\s*'authenticated'/i);
  assert.match(migration, /has_function_privilege\(\s*'service_role'/i);
  assert.match(migration, /raise exception 'Regression: authenticated/i);
  assert.match(migration, /raise exception 'Regression: service-role/i);
  assert.doesNotMatch(
    migration,
    /revoke\s+execute\b[^;]+from\s+authenticated/i
  );
  assert.doesNotMatch(migration, /drop\s+function/i);
});
