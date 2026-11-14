import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sqlBytes = readFileSync(
  new URL(
    '../supabase/staging-migrations/20261110080421_formal_scout_level_staging_2762_20261110.sql',
    import.meta.url
  )
);
const sql = sqlBytes.toString('utf8');
const schema = 'novelight_formal_private.';
const reviewName = schema + 'review_scout_30_days';
const requiredBlob = 'd75e3479e5c254069b5b00ab3c5aadbeadbe39e5';

function reviewFunction() {
  const start = sql.indexOf('create or replace function ' + reviewName + '(');
  const end = sql.indexOf('end $$;', start);
  assert.ok(start >= 0 && end > start);
  return sql.slice(start, end + 'end $$;'.length);
}

test('existing Staging SQL matches the reviewed main Git blob', () => {
  const hash = createHash('sha1')
    .update('blob ' + sqlBytes.length + '\0')
    .update(sqlBytes)
    .digest('hex');
  assert.equal(hash, requiredBlob);
});

test('formal state and review claims have private RLS and a unique key', () => {
  for (const table of ['scout_level_state', 'scout_review_claim']) {
    const name = schema + table;
    assert.ok(sql.includes('create table ' + name + ' ('));
    assert.ok(
      sql.includes('alter table ' + name + ' enable row level security;')
    );
  }
  assert.ok(sql.includes('primary key (user_id, window_end_at)'));
  assert.ok(sql.includes('current_level smallint not null'));
  assert.ok(sql.includes('highest_level smallint not null'));
  assert.ok(sql.includes('level_progress_xp integer not null'));
  assert.ok(sql.includes('review_anchor_at timestamptz not null'));
  assert.ok(sql.includes('last_review_end_at timestamptz'));
  assert.ok(sql.includes('revision bigint not null default 0'));
});

test('main already provides the private review function signature', () => {
  const body = reviewFunction();
  assert.ok(body.length > 100);
  assert.ok(body.includes('p_user_id uuid,'));
  assert.ok(body.includes('p_as_of timestamptz'));
  assert.ok(body.includes('language plpgsql security definer'));
  assert.ok(body.includes("set search_path = ''"));
});

test('review uses an oldest-first 30-day XP quota and hold policy', () => {
  const body = reviewFunction();
  assert.ok(body.includes('where user_id=p_user_id for update'));
  assert.ok(body.includes('v_end := v_start+interval'));
  assert.ok(body.includes("interval '30 days'"));
  assert.ok(body.includes('p_as_of > clock_timestamp()'));
  assert.ok(body.includes("'not_due'"));
  assert.ok(body.includes("'already_reviewed'"));
  assert.ok(body.includes('x.occurred_at>=v_start'));
  assert.ok(body.includes('x.occurred_at<v_end'));
  assert.ok(body.includes('x.xp_value<0'));
  assert.ok(body.includes("'adjustment_policy_pending'"));
  assert.ok(body.includes('v_xp>=200'));
  assert.ok(body.includes('highest_level>=70 then 50 else 1'));
  assert.ok(body.includes('level_progress_xp=case'));
  assert.ok(body.includes('scout_review_claim'));
  assert.ok(body.includes('last_review_end_at=v_end'));
});

test('review RPC is limited to server execution, not client roles', () => {
  const signature = reviewName + '(uuid,timestamptz)';
  assert.ok(sql.includes('revoke all on function ' + signature));
  assert.ok(sql.includes('grant execute on function ' + signature));
  assert.ok(sql.includes('to service_role;'));
  assert.ok(!/grant\s+(?:select|insert|update|delete)/i.test(sql));
});

test('SQL remains a static reference without a scheduler', () => {
  assert.doesNotMatch(sql, /cron\.schedule|create trigger.*review_scout/i);
  assert.ok(!sql.includes('create extension'));
  assert.ok(!sql.includes('function ' + schema + 'review_due_users('));
});
