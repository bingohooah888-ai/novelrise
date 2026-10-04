import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(
  new URL('../scout-lv10-campaign.html', import.meta.url),
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
const migration = readFileSync(
  new URL(
    '../supabase/migrations/20261005090000_scout_lv10_bookcard_campaign.sql',
    import.meta.url
  ),
  'utf8'
);
const rankMigration = readFileSync(
  new URL(
    '../supabase/migrations/20261005090500_scout_campaign_next_rank_progress.sql',
    import.meta.url
  ),
  'utf8'
);
const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('campaign destination page contains the requested progress and claim UI', () => {
  assert.match(page, /終了まで あと/);
  assert.match(page, /本日の読書XP上限/);
  assert.match(page, /CURRENT LEVEL/);
  assert.match(page, /SCOUT RANK/);
  assert.match(page, /NEXT SCOUT RANK/);
  assert.match(page, /次のLEVELまで/);
  assert.match(page, /LEVEL 10まで/);
  assert.match(page, /条件達成しました。/);
  assert.match(page, /図書カードを受け取る/);
  assert.match(page, /500円分/);
});

test('campaign page starts safely in preparation mode until dates are configured', () => {
  assert.match(migration, /'scout-lv10-bookcard-500'/);
  assert.match(migration, /'draft'/);
  assert.match(migration, /starts_at timestamptz/);
  assert.match(migration, /ends_at timestamptz/);
  assert.doesNotMatch(migration, /2026-\d{2}-\d{2}T\d{2}:\d{2}/);
  assert.match(client, /キャンペーン準備中/);
  assert.match(client, /日程確定後に残り日数を表示します/);
});

test('existing homepage banner is deliberately not wired to the campaign page yet', () => {
  assert.doesNotMatch(home, /scout-lv10-campaign\.html/);
});

test('campaign claims are one-per-user and protected behind service role', () => {
  assert.match(migration, /unique \(campaign_id, user_id\)/i);
  assert.match(
    migration,
    /alter table public\.scout_reward_campaigns enable row level security/i
  );
  assert.match(
    migration,
    /alter table public\.scout_reward_campaign_claims enable row level security/i
  );
  assert.match(
    migration,
    /revoke all on public\.scout_reward_campaigns from anon, authenticated/i
  );
  assert.match(
    migration,
    /revoke all on public\.scout_reward_campaign_claims from anon, authenticated/i
  );
  assert.match(
    migration,
    /grant all on public\.scout_reward_campaigns to service_role/i
  );
  assert.match(
    migration,
    /grant all on public\.scout_reward_campaign_claims to service_role/i
  );
});

test('claim submission performs Trust & Safety scan before assigning payout state', () => {
  const scanIndex = migration.indexOf('novelight_trust_scan_user');
  const statusIndex = migration.indexOf('v_claim_status := case');
  const insertIndex = migration.indexOf(
    'insert into public.scout_reward_campaign_claims'
  );
  assert.ok(scanIndex > 0);
  assert.ok(statusIndex > scanIndex);
  assert.ok(insertIndex > statusIndex);
  assert.match(migration, /then 'risk_review' else 'approved_candidate'/);
  assert.doesNotMatch(migration, /gift_code/i);
});

test('campaign progress reuses canonical SCOUT XP, level and rank contracts', () => {
  assert.match(migration, /xp_kind <> 'light_seed_discovery'/);
  assert.match(migration, /novelight_scout_level_for_xp/);
  assert.match(migration, /scout_level_thresholds/);
  assert.match(migration, /xp_kind = 'valid_read'/);
  assert.match(migration, /Asia\/Tokyo/);
  assert.match(
    rankMigration,
    /v_next_rank_level := \(v_rank_tier \* 10\) \+ 1/
  );
  assert.match(rankMigration, /'xp_for_next_rank'/);
});

test('campaign API requires an authenticated same-origin request', () => {
  assert.match(api, /isSameOriginRequest/);
  assert.match(api, /authentication_required/);
  assert.match(api, /supabase\.auth\.getUser\(token\)/);
  assert.match(api, /novelight_scout_campaign_submit_claim/);
});
