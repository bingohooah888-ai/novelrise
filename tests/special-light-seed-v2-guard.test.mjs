import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const migrationPath = new URL(
  '../supabase/migrations/20260928004100_special_light_seed_v2_guard.sql',
  import.meta.url,
);

test('live LIGHT SEED v2 RPCs reject special-zone works server-side', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /public\.light_seed_status_v2\(text\)/);
  assert.match(sql, /public\.plant_light_seed_v2\(text,text\)/);
  assert.match(
    sql,
    /novelight_is_general_discovery_eligible\(n\.ai_usage, n\.content_rating\)/,
  );
  assert.match(sql, /This work is not eligible for LIGHT SEED/);
  assert.match(
    sql,
    /Special-zone LIGHT SEED v2 exclusion anchor not found/,
  );
});
