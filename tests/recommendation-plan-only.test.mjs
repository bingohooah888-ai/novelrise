import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (name) => readFile(new URL(name, import.meta.url), 'utf8');

function definition(sql, name) {
  const from = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const to = sql.indexOf('\n$function$;', from);
  assert.ok(from >= 0 && to > from, `Missing RPC: ${name}`);
  return sql.slice(from, to);
}

test('recommendation RPCs use plan-weighted draws, not rating or exposure priority', async () => {
  const sql = await read('../supabase/migrations/20261012120000_plan_only_recommendations.sql');
  const general = definition(sql, 'novelight_discovery_feed_v2');
  const extra = definition(sql, 'novelight_plan_extra_feed');

  assert.match(general, /r\.free_weight/);
  assert.match(general, /r\.standard_weight/);
  assert.match(general, /r\.premium_weight/);
  assert.match(general, /novelight_is_general_discovery_eligible/);
  assert.match(general, /effective_weight/);
  assert.match(extra, /premium_plan_extra_weight/);
  for (const text of [general, extra]) {
    assert.match(text, /4503599627370496::numeric/);
    assert.match(text, /md5\(v_viewer_key/);
    assert.doesNotMatch(text, /rating_ranked|rating_rank|sensitive_15/);
    assert.doesNotMatch(text, /recently_seen|normalized_author_exposure/);
    assert.doesNotMatch(text, /novel_exposure_events|needs_initial_exposure/);
    assert.doesNotMatch(text, /author_work_rank|author_exposure_7d|plan_extra_7d/);
  }
  assert.doesNotMatch(general, /premium_new_work_boost/);
  assert.match(general, /premium_ranked/);
  assert.match(general, /is_premium_slot/);
});

test('home does not override weighted selection with author-based priorities', async () => {
  const home = await read('../index.html');
  assert.match(home, /selectVisibleDiscoveryRows\(general,planRows,premium,limit\)/);
  assert.match(home, /return unique\.slice\(0,limit\)/);
  assert.doesNotMatch(home, /authors\.has\(author\)/);
  assert.match(home, /if\(visible\.length\)void record\(visible\)/);
});

test('rollback restores previous prioritization without touching LIGHT SEED eligibility', async () => {
  const sql = await read(
    '../supabase/rollback/20261012120000_plan_only_recommendations_rollback.sql'
  );
  const old = definition(sql, 'novelight_discovery_feed_v2');
  assert.match(old, /normalized_author_exposure asc/);
  assert.match(old, /premium_new_work_boost/);
  assert.doesNotMatch(sql, /create or replace function public\.novelight_is_light_seed_eligible/i);
});
