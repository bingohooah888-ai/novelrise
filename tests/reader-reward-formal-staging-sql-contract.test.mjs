import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Read the Staging-only SQL already present in latest main.
// This test is inert: it neither imports draft SQL nor connects to a DB.
const sqlBytes = readFileSync(
  new URL('../supabase/staging-migrations/20261110080421_formal_scout_level_staging_2762_20261110.sql', import.meta.url)
);
const sql = sqlBytes.toString('utf8');
const mainSqlBlob = 'd75e3479e5c254069b5b00ab3c5aadbeadbe39e5';

function functionDefinition(source, name) {
  const pattern = new RegExp(
    'create or replace function\\s+novelight_formal_private\\.' +
    name + '\\s*\\([\\s\\S]*?end\\s+\\$\\$;', 'i'
  );
  return source.match(pattern)?.[0] ?? '';
}

test('existing main Staging SQL is pinned by an exact reviewed Git blob', () => {
  const hash = createHash('sha1')
    .update('blob ' + sqlBytes.length + '\0')
    .update(sqlBytes)
    .digest('hex');
  assert.equal(hash, mainSqlBlob);
});

test('private Level state and one-review-per-window claim are RLS-protected', () => {
  assert.match(sql, /create table novelight_formal_private\.scout_level_state\s*\(/);
  assert.match(sql, /current_level smallint not null check \(current_level between 1 and 100\)/);
  assert.match(sql, /highest_level smallint not null check \(highest_level between 1 and 100\)/);
  assert.match(sql, /level_progress_xp integer not null check \(level_progress_xp >= 0\)/);
  assert.match(sql, /review_anchor_at timestamptz not null/);
  assert.match(sql, /last_review_end_at timestamptz/);
  assert.match(sql, /revision bigint not null default 0/);
  assert.match(sql, /create table novelight_formal_private\.scout_review_claim\s*\(/);
  assert.match(sql, /primary key \(user_id, window_end_at\)/);
  for (const name of ['scout_level_state', 'scout_review_claim']) {
    assert.match(sql, new RegExp(
      'alter table novelight_formal_private\\.' + name + '\\s+enable row level security;'
    ));
  }
});

test('approved main SQL already implements the exact review RPC signature', () => {
  const body = functionDefinition(sql, 'review_scout_30_days');
  assert.ok(body.length > 100);
  assert.match(body, /review_scout_30_days\(\s*p_user_id uuid,\s*p_as_of timestamptz\s*\)/);
  assert.match(body, /language plpgsql security definer/);
  assert.match(body, /set search_path = ''/);
});

test('existing review RPC preserves oldest-first 30-day XP quota and hold conditions', () => {
  const body = functionDefinition(sql, 'review_scout_30_days');
  assert.match(body, /where user_id=p_user_id for update/);
  assert.match(body, /v_start := coalesce\(v_state\.last_review_end_at,v_state\.review_anchor_at\)/);
  assert.match(body, /v_end := v_start\+interval '30 days'/);
  assert.match(body, /p_as_of > clock_timestamp\(\)/);
  assert.match(body, /status','not_due'/);
  assert.match(body, /status','already_reviewed'/);
  assert.match(body, /x\.occurred_at>=v_start and x\.occurred_at<v_end/);
  assert.match(body, /x\.xp_value<0/);
  assert.match(body, /status','adjustment_policy_pending'/);
  assert.match(body, /v_xp>=200/);
  assert.match(body, /highest_level>=70 then 50 else 1/);
  assert.match(body, /level_progress_xp=case when v_next<v_state\.current_level then 0/);
  assert.match(body, /insert into novelight_formal_private\.scout_review_claim/);
  assert.match(body, /last_review_end_at=v_end/);
});

test('review RPC revokes client roles and grants only service role execution', () => {
  const body = functionDefinition(sql, 'review_scout_30_days');
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = ''/);
  assert.match(sql, /revoke all on function novelight_formal_private\.review_scout_30_days\(uuid,timestamptz\)[\s\S]*?from public,anon,authenticated/);
  assert.match(sql, /grant execute on function novelight_formal_private\.review_scout_30_days\(uuid,timestamptz\)[\s\S]*?to service_role/);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete)[\s\S]{0,80}to\s+(?:anon|authenticated)/i);
});

test('SQL remains a static reference without a review cron or executor', () => {
  assert.doesNotMatch(sql, /create extension|create trigger.*review_scout|cron\.schedule/gi);
  assert.equal(functionDefinition(sql, 'review_due_users'), '');
});
