import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath =
  'supabase/migrations/20260921025328_scout_record_usage_controls.sql';
const precheckPath =
  'supabase/checks/20260921025328_scout_record_usage_controls_precheck.sql';
const postcheckPath =
  'supabase/checks/20260921025328_scout_record_usage_controls_postcheck.sql';
const rollbackPath =
  'supabase/rollback/20260921025328_scout_record_usage_controls_rollback.sql';
const replayPath = 'scripts/run-migration-replay.sh';

function has(text, token) {
  assert.equal(text.includes(token), true, `missing token: ${token}`);
}

test('SCOUT RECORD usage days are private and owner-recorded through RPC', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, 'create table public.scout_record_usage_days');
  has(sql, 'primary key (user_id, activity_date)');
  has(
    sql,
    'alter table public.scout_record_usage_days enable row level security'
  );
  has(
    sql,
    'revoke all on table public.scout_record_usage_days from public, anon, authenticated'
  );
  has(
    sql,
    'create or replace function public.novelight_record_scout_record_visit()'
  );
  has(sql, 'v_uid uuid := (select auth.uid())');
  has(sql, 'on conflict (user_id, activity_date) do update');
  has(
    sql,
    'grant execute on function public.novelight_record_scout_record_visit()'
  );
  has(sql, 'to authenticated;');
});

test('positive automatic Scout Point awards are centrally suspendable', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, 'create table public.scout_point_user_controls');
  has(sql, 'earning_suspended_until timestamptz');
  has(sql, 'create trigger scout_point_earning_control');
  has(sql, 'before insert on public.scout_point_ledger');
  has(sql, "new.point_kind in ('reversal', 'manual_adjustment')");
  has(
    sql,
    'if not public.novelight_scout_point_earning_allowed(new.user_id) then'
  );
  has(sql, 'return null;');
});

test('operator Point control is service-role only and keeps an audit trail', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, 'create table public.scout_point_operator_actions');
  has(sql, 'action in (');
  for (const action of [
    "'freeze'",
    "'confirm'",
    "'cancel'",
    "'suspend_points'",
    "'resume_points'",
    "'adjust'"
  ]) {
    has(sql, action);
  }
  has(
    sql,
    'create or replace function public.novelight_admin_scout_point_action'
  );
  has(
    sql,
    'grant execute on function public.novelight_admin_scout_point_action'
  );
  has(sql, 'to service_role;');
  assert.doesNotMatch(
    sql,
    /grant\s+execute\s+on\s+function\s+public\.novelight_admin_scout_point_action[\s\S]{0,300}to\s+authenticated/iu
  );
});

test('confirmed Point cancellation uses a negative reversal and never deletes the original', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, "'reversal'");
  has(sql, '-v_ledger.point_value');
  has(sql, "'admin_reversal:' || v_ledger.id::text");
  has(sql, 'reversal_of');
  has(sql, "elsif v_ledger.status in ('pending', 'frozen') then");
  has(sql, "set status = 'cancelled'");
  assert.doesNotMatch(sql, /delete\s+from\s+public\.scout_point_ledger/iu);
});

test('manual Point adjustment is bounded and reason-attributed', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, "v_action = 'adjust'");
  has(sql, 'p_amount is null or p_amount = 0 or abs(p_amount) > 100000');
  has(sql, "'manual_adjustment'");
  has(sql, "'reason', v_reason");
  has(sql, "'actor_user_id', p_actor_user_id");
});

test('usage/control checks are fail-closed and rollback preserves real audit data', async () => {
  const [precheck, postcheck, rollback, replay] = await Promise.all([
    readFile(precheckPath, 'utf8'),
    readFile(postcheckPath, 'utf8'),
    readFile(rollbackPath, 'utf8'),
    readFile(replayPath, 'utf8')
  ]);
  has(
    precheck,
    'SCOUT core, badge foundation, and beta lifecycle are required'
  );
  has(postcheck, 'SCOUT operator RPC must be service-role only');
  has(postcheck, 'Central Scout Point earning control trigger is missing');
  has(rollback, 'v_has_usage');
  has(rollback, 'v_has_controls');
  has(rollback, 'v_has_actions');
  assert.doesNotMatch(rollback, /delete\s+from|truncate\s+/iu);
  has(replay, 'Verify SCOUT usage controls, rollback and reapply');
});
