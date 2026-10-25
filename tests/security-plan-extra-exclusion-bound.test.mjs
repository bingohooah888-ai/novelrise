import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/20261025050000_bound_plan_extra_exclusions.sql',
    import.meta.url
  ),
  'utf8'
);

test('anonymous plan-extra RPC rejects oversized exclusion arrays', () => {
  const guard = migration.indexOf('cardinality(p_exclude_novel_ids)');
  const query = migration.indexOf('return query');
  assert.ok(guard > 0 && query > guard);
  assert.match(
    migration,
    /coalesce\(cardinality\(p_exclude_novel_ids\), 0\) > 128/i
  );
  assert.match(migration, /errcode = '22023'/i);
  assert.match(migration, /Too many excluded novel IDs/i);
});

test('bounded exclusions preserve plan extra behavior and grants', () => {
  assert.match(migration, /p_limit < 1 or p_limit > 3/i);
  assert.match(migration, /Anonymous discovery requires a visitor token/i);
  assert.match(migration, /where o\.feed_position <= p_limit/i);
  assert.doesNotMatch(migration, /\brevoke\s+(?:all|execute)/i);
  assert.doesNotMatch(migration, /\bdrop\s+function/i);
  assert.match(migration, /\nbegin;[\s\S]*\ncommit;\s*$/i);
});
