import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const migration = readFileSync(
  new URL('../supabase/migrations/20261025032000_light_seed_guest_status_no_rank_write.sql', import.meta.url),
  'utf8'
);

test('guest LIGHT SEED status never initializes rank-state rows', () => {
  assert.match(migration, /create or replace function public\.light_seed_status_auto_v1\(p_novel_id text\)/i);
  assert.match(migration, /if v_uid is not null then\s+insert into public\.novel_rank_state\s*\(/i);
  assert.match(migration, /on conflict \(novel_id_snapshot\) do nothing;\s+end if;/i);
  assert.match(migration, /if v_uid is null then\s+return jsonb_build_object\(/i);
  assert.match(migration, /'reason', 'login_required'/i);
  assert.match(migration, /'total_seed_count', v_total_seeds/i);
});

test('authenticated LIGHT SEED status retains rank and eligibility rules', () => {
  assert.match(migration, /when v_rank between 1 and 2 then 'GOLD'/i);
  assert.match(migration, /when v_rank between 3 and 4 then 'SILVER'/i);
  assert.match(migration, /perform public\.novelight_ensure_light_seed_inventory\(v_uid, v_month\)/i);
  assert.match(migration, /v_can_plant := true;/i);
  assert.doesNotMatch(migration, /revoke\s+(?:all|execute)/i);
  assert.doesNotMatch(migration, /drop\s+function/i);
});
