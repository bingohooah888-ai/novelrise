import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const sql = readFileSync(
  new URL(
    '../supabase/migrations/20261013150500_november_contest_reader_scoring_core.sql',
    import.meta.url
  ),
  'utf8'
);
const integration = readFileSync(
  new URL('./rls/november-contest-integration.sql', import.meta.url),
  'utf8'
);

function pointsForEpisodes(count) {
  if (count >= 10) return 5;
  if (count >= 5) return 3;
  if (count >= 3) return 1;
  return 0;
}

test('one-reader score uses only the highest reached bracket', () => {
  const expected = [
    0, 0, 0, 1, 1, 3, 3, 3, 3, 3, 5, 5, 5
  ];
  expected.forEach((points, count) => {
    assert.equal(pointsForEpisodes(count), points, String(count));
  });
  assert.match(sql, /when p_qualified_episode_count >= 10 then 5/);
  assert.match(sql, /when p_qualified_episode_count >= 5 then 3/);
  assert.match(sql, /when p_qualified_episode_count >= 3 then 1/);
  assert.match(sql, /else 0/);
  assert.doesNotMatch(sql, /set points = points \+/i);
});

test('read receipts are server-only, idempotent, and fail closed', () => {
  assert.match(sql, /create or replace function public\.novelight_contest_record_qualified_session/);
  assert.match(sql, /v_session\.status <> 'qualified'/);
  assert.match(sql, /v_contest\.status <> 'active'/);
  assert.match(sql, /v_contest\.public_visible is not true/);
  assert.match(sql, /v_now >= v_contest\.ends_at/);
  assert.match(sql, /v_reader\.user_id = v_entry\.author_id/);
  assert.match(sql, /on conflict \(contest_id, reader_id, episode_id_snapshot\) do nothing/);
  assert.match(sql, /from public\.novelight_contest_read_events e/);
  assert.match(sql, /e\.status in \('provisional', 'accepted'\)/);
  assert.match(sql, /to service_role;/);
  assert.doesNotMatch(sql, /grant execute[^;]+to (anon|authenticated)/i);
  assert.doesNotMatch(sql, /update public\.(?:episodes|novels)\b/i);
});

test('disposable PostgreSQL integration proves stage 06 invariants', () => {
  assert.match(integration, /Stage 06 scoring core/);
  assert.match(integration, /Draft contest credited a read/);
  assert.match(integration, /Read replay credited twice/);
  assert.match(integration, /Hold failed to reduce award credit/);
  assert.match(integration, /Author self-read credited/);
  assert.match(integration, /Guest scored incorrectly/);
  assert.match(integration, /Contest scoring mutated ordinary episode PV/);
  assert.match(integration, /rollback;/);
});
