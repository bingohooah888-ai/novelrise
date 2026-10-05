import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const master = readFileSync(
  new URL('../docs/NOVELIGHT-MASTER.md', import.meta.url),
  'utf8'
);
const migration = readFileSync(
  new URL(
    '../supabase/migrations/20261005153000_scout_xp_daily_40_rules.sql',
    import.meta.url
  ),
  'utf8'
);
const client = readFileSync(
  new URL('../novelight-scout-campaign.js', import.meta.url),
  'utf8'
);
const api = readFileSync(
  new URL('../api/_lib/scout-lv10-campaign.js', import.meta.url),
  'utf8'
);

test('MASTER defines the canonical 40 XP daily SCOUT activity rules', () => {
  assert.match(master, /有効読書（作品）Scout XP/);
  assert.match(master, /1作品につき2 Scout XP/);
  assert.match(master, /1日5作品まで/);
  assert.match(master, /最大10 XP/);

  assert.match(master, /有効読書（話）Scout XP/);
  assert.match(master, /1話につき1 Scout XP/);
  assert.match(master, /1日15話まで/);
  assert.match(master, /最大15 XP/);

  assert.match(master, /コメントScout XP/);
  assert.match(master, /1作品につき5 Scout XP/);
  assert.match(master, /1日3作品まで/);
  assert.match(master, /1日最大40 XP/);

  assert.doesNotMatch(master, /^### ☆評価Scout XP$/m);
  assert.doesNotMatch(master, /^#### ☆評価$/m);
  assert.match(master, /正当に付与済みの☆評価Scout XPは履歴として保持/);
  assert.match(master, /仕様変更後の☆評価はScout XP対象外/);
});

test('valid reads award separate work and episode SCOUT XP buckets', () => {
  assert.match(migration, /xp_kind = 'valid_read'/);
  assert.match(migration, /v_work_awarded_today < 5/);
  assert.match(
    migration,
    /'valid_read', 2, 'chapter49-beta-v2'/
  );

  assert.match(migration, /xp_kind = 'valid_read_episode'/);
  assert.match(migration, /v_episode_awarded_today < 15/);
  assert.match(
    migration,
    /'valid_read_episode', 1, 'chapter49-beta-v2'/
  );
  assert.match(migration, /episode_id_snapshot = new\.episode_id_snapshot/);
});

test('star rating remains product data but stops creating future SCOUT XP', () => {
  assert.match(
    migration,
    /create or replace function public\.set_novel_star_rating/
  );
  assert.match(migration, /'scout_xp_eligible', false/);
  assert.doesNotMatch(migration, /'star_rating'\s*,\s*3/);
  assert.doesNotMatch(
    migration,
    /delete\s+from\s+public\.scout_xp_ledger/i
  );
});

test('campaign progress exposes the three daily activity buckets', () => {
  assert.match(migration, /today_valid_read_xp_cap', 10/);
  assert.match(migration, /today_valid_read_episode_xp_cap', 15/);
  assert.match(migration, /today_comment_xp_cap', 15/);
  assert.match(migration, /today_activity_xp_cap', 40/);

  assert.match(client, /today_valid_read_xp_cap \?\? 10/);
  assert.match(client, /today_valid_read_episode_xp/);
  assert.match(client, /today_comment_xp/);

  assert.match(api, /todayXpFor\('valid_read'\)/);
  assert.match(api, /todayXpFor\('valid_read_episode'\)/);
  assert.match(api, /todayXpFor\('comment'\)/);
  assert.match(api, /today_activity_xp_cap: 40/);
});
