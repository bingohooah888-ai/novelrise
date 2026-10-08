import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

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
const entryMigration = readFileSync(
  new URL(
    '../supabase/migrations/20261005112000_scout_campaign_entry_windows.sql',
    import.meta.url
  ),
  'utf8'
);
const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('campaign destination page contains the requested progress and claim UI', () => {
  assert.match(page, /終了まで あと/);
  assert.match(page, /本日の有効読書XP/);
  assert.match(page, /本日の有効読書（話）XP/);
  assert.match(page, /本日のコメントXP/);
  assert.match(page, /CURRENT LEVEL/);
  assert.match(page, /SCOUT RANK/);
  assert.match(page, /次のLEVELまで/);
  assert.doesNotMatch(page, /NEXT SCOUT RANK/);
  assert.doesNotMatch(page, /id="targetXpRemaining"/);
  assert.match(page, /条件達成しました。/);
  assert.match(page, /図書カードを受け取る/);
  assert.match(page, /500円分/);
});

test('campaign countdown uses the personal 60-day LEVEL 10 deadline', () => {
  assert.match(client, /LEVEL 10 DEADLINE/);
  assert.match(client, /LEVEL 10達成期限までの日数/);
  assert.match(client, /達成期限まで あと/);
  assert.match(client, /deadlineDaysRemaining/);
  assert.match(client, /jstDayNumber/);
  assert.match(client, /timeZone: 'Asia\/Tokyo'/);
  assert.match(client, /eligibility\.daysRemaining/);
  assert.match(client, /eligibility\.eligibilityDeadline/);
  assert.match(client, /LEVEL 10達成期限：/);
  assert.doesNotMatch(client, /configuredWindowDays/);
  assert.match(api, /daysRemaining\(eligibilityDeadline, now\)/);
  assert.match(api, /jstDayBounds\(deadline\)\.start/);
  assert.doesNotMatch(
    client,
    /countdownNote', `参加受付：\$\{formatDate\(campaign\.endsAt\)\}まで（JST）`/
  );
});

test('campaign display shows the planned 40 XP daily breakdown', () => {
  assert.match(page, /SCOUT XPの獲得条件/);
  assert.match(page, /有効読書（作品）/);
  assert.match(page, /2 XP × 5作品まで/);
  assert.match(page, /最大10 XP/);
  assert.match(page, /有効読書（話）/);
  assert.match(page, /1 XP × 15話まで/);
  assert.match(page, /コメント/);
  assert.match(page, /5 XP × 3作品まで/);
  assert.match(page, /最大15 XP/);
  assert.match(page, /合計最大40 XP/);
  assert.doesNotMatch(page, /星評価/);
  assert.match(client, /today_valid_read_xp_cap \?\? 10/);
  assert.match(client, /today_valid_read_episode_xp/);
  assert.match(client, /today_comment_xp/);
  assert.match(client, /本日の有効読書XPはあと/);
});

test('campaign remains draft while the approved entry schedule is encoded', () => {
  assert.match(migration, /'scout-lv10-bookcard-500'/);
  assert.match(migration, /'draft'/);
  assert.match(entryMigration, /2026-10-06 06:00:00\+09/);
  assert.match(entryMigration, /2026-10-31 23:59:59\.999999\+09/);
  assert.match(entryMigration, /2026-10-05 11:13:36\+09/);
  assert.doesNotMatch(entryMigration, /status\s*=\s*'active'/i);
  assert.match(client, /キャンペーン準備中/);
});

test('homepage campaign banner uses the manually approved official mode', () => {
  assert.match(home, /id="homeLeadLink"/);
  assert.match(home, /05_event_teaser_1600x900\.png/);
  assert.match(home, /05_campaign_official_after_announcement_1600x900\.png/);
  assert.match(home, /href: 'scout-lv10-campaign\.html'/);
  assert.match(home, /const currentLeadVisual = 'official'/);
  assert.match(home, /時刻による自動切替は行わない/);
  assert.doesNotMatch(
    home,
    /currentLeadVisual\s*=\s*Date|currentLeadVisual\s*=\s*new Date/i
  );
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
    entryMigration,
    /alter table public\.scout_reward_campaign_entries enable row level security/i
  );
  assert.match(
    entryMigration,
    /revoke all on public\.scout_reward_campaign_entries from anon, authenticated/i
  );
  assert.match(
    entryMigration,
    /grant all on public\.scout_reward_campaign_entries to service_role/i
  );
});

test('claim submission performs Trust & Safety scan before assigning payout state', () => {
  const scanIndex = entryMigration.indexOf('novelight_trust_scan_user');
  const statusIndex = entryMigration.indexOf('v_claim_status := case');
  const insertIndex = entryMigration.indexOf(
    'insert into public.scout_reward_campaign_claims'
  );
  assert.ok(scanIndex > 0);
  assert.ok(statusIndex > scanIndex);
  assert.ok(insertIndex > statusIndex);
  assert.match(entryMigration, /then 'risk_review' else 'approved_candidate'/);
  assert.doesNotMatch(entryMigration, /gift_code/i);
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

test('eligibility clock is anchored to signup or first eligible login', () => {
  assert.match(entryMigration, /scout_reward_campaign_entries/);
  assert.match(entryMigration, /after insert on auth\.users/i);
  assert.match(
    entryMigration,
    /after update of last_sign_in_at on auth\.users/i
  );
  assert.match(
    entryMigration,
    /on conflict \(campaign_id, user_id\) do nothing/i
  );
  assert.match(
    entryMigration,
    /v_eligibility_started_at := v_campaign\.starts_at/
  );
  assert.match(entryMigration, /v_eligibility_started_at := v_login_at/);
  assert.match(entryMigration, /v_eligibility_started_at := new\.created_at/);
  assert.match(entryMigration, /new\.created_at > v_campaign\.ends_at/);
  assert.match(entryMigration, /v_login_at > v_campaign\.ends_at/);
  assert.match(api, /eligibilityStartedAt/);
  assert.match(api, /entry_required/);
  assert.match(client, /10月6日6:00までの事前ログインは10月6日6:00開始扱い/);
});

test('authenticated campaign access safely backfills a missing eligibility entry', () => {
  assert.match(api, /async function ensureEntry/);
  assert.match(api, /if \(entry \|\| !campaign\.id\) return entry/);
  assert.match(api, /campaign\.status !== 'active'/);
  assert.match(api, /firstEligibleLoginAt = requestNow/);
  assert.match(api, /eligibilityStartedAt = requestNow/);
  assert.match(api, /String\(insertError\.code \?\? ''\) !== '23505'/);
  assert.match(api, /const entry = await ensureEntry/);
});

test('prelaunch grace backfill preserves the first eligibility clock', () => {
  assert.match(
    entryMigration,
    /u\.last_sign_in_at >= c\.prelaunch_login_grace_starts_at/
  );
  assert.match(entryMigration, /u\.last_sign_in_at < c\.starts_at/);
  assert.match(
    entryMigration,
    /on conflict \(campaign_id, user_id\) do nothing/i
  );
  assert.doesNotMatch(
    entryMigration,
    /on conflict \(campaign_id, user_id\) do update/i
  );
});

test('campaign API requires an authenticated same-origin request', () => {
  assert.match(api, /isSameOriginRequest/);
  assert.match(api, /authentication_required/);
  assert.match(api, /supabase\.auth\.getUser\(token\)/);
  assert.match(api, /novelight_scout_campaign_submit_claim/);
});

test('campaign landing hero prioritizes reward and supports approved artwork', () => {
  assert.match(page, /小説を読んで、/);
  assert.match(page, /図書カードネットギフト500円分/);
  assert.match(page, /新規登録して無料で参加/);
  assert.match(page, /ログインして参加/);
  assert.match(page, /作品を探してXPを貯める/);
  assert.match(page, /SCOUT RECORDを見る/);
  assert.match(page, /NOVELIGHT_SCOUT_MOBILE_941x1672.webp/);
  assert.match(page, /STEP 1/);
  assert.match(page, /STEP 2/);
  assert.match(page, /STEP 3/);
});

test('approved PC and mobile campaign image files are present before release', () => {
  for (const name of [
    'NOVELIGHT_SCOUT_PC_1888x913.webp',
    'NOVELIGHT_SCOUT_MOBILE_941x1672.webp'
  ]) {
    const bytes = readFileSync(new URL('../assets/' + name, import.meta.url));
    assert.ok(bytes.length > 10000, name + ': suspiciously small');
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  }
});
